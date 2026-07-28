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

## Consuming a vector

The file is plain JSON with no dependencies, readable from Swift, Kotlin, Dart,
Go, and JavaScript tests. Resolve it by repository-relative path rather than by
package manager: the SDKs are not npm consumers.

```
packages/test-fixtures/src/billing-reference-vectors.json
```

## Regenerating

```bash
node packages/test-fixtures/src/build-billing-reference-vectors.mjs
```

Digests are computed by the generator and must never be hand-edited: a
hand-edited digest would assert five implementations against a value no
implementation produces.

## Verification

`protocol/tools/billing-ingestion-validation-v1.test.mjs` recomputes every
digest, checks each vector against the contract's own patterns, and asserts that
the canonical vectors match the values actually carried by
`protocol/fixtures/billing-ingestion/v1/google-client-observation.json` and
`apple-client-observation.json`. The vectors and the canonical fixtures
therefore cannot drift apart.

```bash
npm --prefix protocol test
```
