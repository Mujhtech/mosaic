# @mosaic/test-fixtures

Cross-implementation reference vectors: inputs and expected outputs that every
Mosaic implementation must agree on, for values whose derivation is a contract
rather than an implementation detail.

These are **not** protocol fixtures. Canonical protocol documents live in
`protocol/fixtures/`. This package holds the small number of primitive
derivations that the schema can constrain the *shape* of but not the *value* of
— where five independent implementations could each be schema-valid and still
disagree.

## `src/billing-reference-vectors.json`

Vectors for the two provider reference kinds of
[Billing Ingestion Contract v1](../../docs/protocol/billing-ingestion-v1.md).
The kinds themselves are defined in
`protocol/schema/billing-ingestion/v1/observation.schema.json` at
`#/$defs/referenceKind`, and their derivations are pinned in the
`referenceKinds` block of `protocol/compatibility/billing-ingestion/v1.json`.

### `google_play_token_digest`

**SHA-256 over the UTF-8 bytes of the Google Play purchase token, rendered as
lowercase hexadecimal, unprefixed, exactly 64 characters.**

The raw purchase token is bearer-grade material. It never leaves the device and
never appears in the contract; the digest is what Mosaic joins on. That makes the
derivation load-bearing: if the Android, Flutter, iOS, and backend
implementations do not compute byte-identical digests, observations silently fail
to join and duplicate facts are impossible to detect.

Each vector carries `token`, `tokenUtf8ByteLength`, and the expected `digest`.
Assert `tokenUtf8ByteLength` first — if it does not match, the JSON was decoded
with the wrong encoding and the digest comparison would fail for a misleading
reason.

The `non-ascii-token` vector is the one that matters. A UTF-16, Latin-1, or
platform-default encoding agrees with UTF-8 on every ASCII input, so an
ASCII-only test suite passes while the implementation is wrong.

Do not trim, Unicode-normalize, base64-decode, uppercase, or prefix the result.

### `app_store_transaction_id`

**The raw decimal App Store transaction identifier, submitted verbatim as a
string.**

There is no derivation to agree on here — the risk is numeric handling. StoreKit
exposes `Transaction.id` as a `UInt64`. Values above 2^53-1 do not survive an
IEEE-754 double, and values above 2^63-1 overflow a signed 64-bit integer, so
the value must be carried as a string end to end and never parsed into a
platform integer or emitted as a JSON number.

The `beyond-double-precision` and `uint64-max` vectors exist to fail loudly when
an implementation parses instead of carrying.

## Authoritative Entitlement vectors

Three files for [Authoritative Entitlement Contract v2](../../docs/protocol/authoritative-entitlement-v2.md),
built by `src/build-entitlement-reference-vectors.mjs`. These are the derivations
Go, Dart, Swift, Kotlin, and the protocol validator must agree on exactly, and
that a schema can constrain the *shape* of but not the *value* of. Two SDKs can
both be schema-valid and still disagree about whether a cached snapshot should be
replaced, or whether an offline cache has expired, and the user experience of
that disagreement is losing access they paid for.

### `src/entitlement-snapshot-digest-vectors.json`

The canonical serialization that `contentDigest` and `checksum` are computed
over: minified JSON, object members sorted by UTF-16 code unit at every depth,
**array order preserved**, absent members omitted, `null` never emitted,
timestamps at exactly three fractional digits, integers in shortest decimal form,
minimal string escaping.

Each vector carries `payload`, `canonicalSerialization`, `canonicalByteLength`,
and the expected `digest`. Assert the serialization first — if it does not match,
the digest comparison would fail for a misleading reason.

The `non-ascii-safe-text` vector is the one that matters: a UTF-16 or Latin-1
encoding agrees with UTF-8 on every ASCII input, so an ASCII-only suite passes
while the implementation is wrong. The `absent-optional` / `present-optional`
pair proves absent and present are different states, which is why `null` is
forbidden rather than merely discouraged. The `array-order-is-preserved` vector
carries a deliberately unsorted array: a serializer that sorted it would silently
repair a document the semantic validator exists to reject.

`canonical-fixture-snapshot` is the `payload.snapshot` of
`protocol/fixtures/authoritative-entitlement/v2/ios-full-snapshot.json`, and a
test asserts its digest equals that snapshot's `contentDigest`. The contract
wraps the customer entitlement snapshot in an authority envelope rather than
restating it, so the digest covers the nested body.

### `src/entitlement-cache-decision-vectors.json`

`(cached, incoming) -> accept | reject` with a reason, a cache action
(`preserve`, `clear`, `replace`), and the resulting access state. The
`evaluationOrder` is normative: binding is checked **before** version, because
snapshot versions are monotonic per Environment and a staging snapshot
legitimately starts at 1.

No vector ever resolves to `inactive`, and a test enforces that. A binding
mismatch is the only rejection that **clears** rather than preserves the cache.

### `src/entitlement-freshness-vectors.json`

`(issuedAt, asOf, refreshAfter, validUntil, staleGraceSeconds, deviceNow, skew=60s)`
-> `fresh` | `refresh_recommended` | `stale_within_grace` | `expired`, including
backwards and forwards clocks.

`backwards-clock-before-issued-at` is the security-relevant one. A naive
implementation computes a negative cache age, concludes "fresh", and hands
unlimited offline access to anyone willing to change their device time. The
expected state is `expired`. `backwards-clock-within-skew` guards the opposite
error: ordinary 30-second phone-to-server skew must not trip that path.

## `src/webhook-signature-vectors.json`

For [Billing State Webhook Contract v2](../../docs/protocol/billing-state-webhook-v2.md),
built by `src/build-webhook-signature-vectors.mjs`.

```text
signature = HMAC-SHA256(secret, "v1" + "." + t + "." + eventId + "." + rawBody)
```

The literal `v1` is the signature **scheme** version carried in the `v1=` header
parameter. It is not the contract version and does not move when the contract
version does.

Each vector carries `secret`, `timestamp`, `eventId`, `rawBody`, the assembled
`signedPayload`, the expected `signature`, and the full `Mosaic-Signature` header
value. The `tampered-body`, `different-event-id`, and `different-timestamp`
vectors must **not** verify against the canonical signature; that is what proves
each component is genuinely covered rather than merely carried alongside.

`canonical-event-primary-key` signs the bytes of
`protocol/fixtures/billing-state-webhook/v2/events/entitlement-activated.json`
**with the file's trailing newline removed** — the builder applies `trimEnd()` —
and a test asserts the two cannot drift. The trailing newline belongs to the file
on disk, not to a delivery. The raw body must be hashed **as received**: a
verifier that parses and re-serializes, or that trims, gets different bytes and
rejects every genuine delivery.

`non-ascii-body` and `non-ascii-secret` prove both the payload and the key are
taken as UTF-8 bytes, the secret used verbatim rather than hex- or base64-decoded.

## Consuming a vector

The file is plain JSON with no dependencies, readable from Swift, Kotlin, Dart,
Go, and JavaScript tests. Resolve it by repository-relative path rather than by
package manager: the SDKs are not npm consumers.

```
packages/test-fixtures/src/billing-reference-vectors.json
packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json
packages/test-fixtures/src/entitlement-cache-decision-vectors.json
packages/test-fixtures/src/entitlement-freshness-vectors.json
packages/test-fixtures/src/webhook-signature-vectors.json
```

## Regenerating

```bash
npm --prefix packages/test-fixtures run generate
```

Or individually:

```bash
node packages/test-fixtures/src/build-billing-reference-vectors.mjs
node packages/test-fixtures/src/build-entitlement-reference-vectors.mjs
node packages/test-fixtures/src/build-webhook-signature-vectors.mjs
```

Digests and signatures are computed by the generators and must never be
hand-edited: a hand-edited value would assert five implementations against a
result no implementation produces.

## Verification

Every vector family is verified by the protocol test suite, which recomputes each
derivation rather than trusting the committed value, and cross-checks the
canonical vectors against the fixtures they claim to describe. The vectors and
the canonical fixtures therefore cannot drift apart.

| Vectors | Verified by |
| --- | --- |
| `billing-reference-vectors.json` | `protocol/tools/billing-ingestion-validation-v1.test.mjs` |
| `entitlement-snapshot-digest-vectors.json` | `protocol/tools/authoritative-entitlement-validation.test.mjs` |
| `entitlement-cache-decision-vectors.json` | `protocol/tools/authoritative-entitlement-validation.test.mjs` |
| `entitlement-freshness-vectors.json` | `protocol/tools/authoritative-entitlement-validation.test.mjs` |
| `webhook-signature-vectors.json` | `protocol/tools/billing-state-webhook-validation.test.mjs` |

The freshness vectors are additionally re-derived from the declared window in the
test rather than compared to a stored answer, so a vector whose expected state
disagrees with its own inputs fails.

```bash
npm --prefix protocol test
```
