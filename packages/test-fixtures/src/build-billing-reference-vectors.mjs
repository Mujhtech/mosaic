/**
 * Regenerates `billing-reference-vectors.json`.
 *
 * Digests are computed, never hand-written. Editing a digest by hand is the one
 * way this file could quietly stop meaning anything: five implementations would
 * all be asserted against a value no implementation produced.
 *
 * Run: node packages/test-fixtures/src/build-billing-reference-vectors.mjs
 * Verified by: protocol/tools/billing-ingestion-validation-v1.test.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const googleVector = (id, token, notes) => ({
  id,
  token,
  tokenUtf8ByteLength: Buffer.byteLength(token, "utf8"),
  digest: sha256(token),
  notes,
});

const document = {
  $comment:
    "Generated cross-SDK reference vectors. Regenerate with " +
    "packages/test-fixtures/src/build-billing-reference-vectors.mjs; never hand-edit a digest.",
  contract: "Billing Ingestion Contract v1",
  contractVersion: "1",
  referenceKindDefinition:
    "protocol/schema/billing-ingestion/v1/observation.schema.json#/$defs/referenceKind",
  compatibilityManifest: "protocol/compatibility/billing-ingestion/v1.json",
  googlePlayTokenDigest: {
    referenceKind: "google_play_token_digest",
    derivation: "sha256_utf8_lowercase_hex",
    algorithm: {
      hash: "SHA-256",
      inputEncoding: "UTF-8",
      output: "lowercase hexadecimal",
      outputLength: 64,
      prefix: null,
    },
    rule:
      "Hash the raw purchase token bytes as UTF-8. Do not trim, normalize Unicode, " +
      "base64-decode, uppercase, or prefix the result. The raw token never leaves the " +
      "device and never appears in this contract.",
    vectors: [
      googleVector(
        "canonical-fixture-token",
        "fixture-google-purchase-token-0001",
        "The value carried by protocol/fixtures/billing-ingestion/v1/google-client-observation.json. " +
          "An SDK that reproduces this digest agrees with the canonical fixture.",
      ),
      googleVector(
        "distinct-token",
        "fixture-google-purchase-token-0002",
        "A different token must produce a different digest; guards a constant or truncated implementation.",
      ),
      googleVector(
        "non-ascii-token",
        "fixture-google-purchase-token-ünïcödé-中文-0003",
        "Proves UTF-8 encoding. A UTF-16, Latin-1, or platform-default encoding produces a different " +
          "digest here and agrees on every ASCII vector, so this is the vector that actually catches the bug.",
      ),
      googleVector(
        "long-token",
        `fixture-google-purchase-token-${"0".repeat(200)}`,
        "A realistic-length token. The digest is always 64 characters regardless of input size.",
      ),
    ],
  },
  appStoreTransactionId: {
    referenceKind: "app_store_transaction_id",
    derivation: "raw_decimal_provider_value",
    rule:
      "Submit the provider value verbatim as a decimal string. Never parse it into a signed 64-bit " +
      "integer, a platform int, or a JSON number: values above 2^53-1 lose precision as an IEEE-754 " +
      "double, and values above 2^63-1 overflow a signed 64-bit integer. Carry it as a string end to end.",
    pattern: "^[0-9]{1,24}$",
    vectors: [
      { id: "minimum", value: "1", notes: "Lower bound of the pattern." },
      {
        id: "canonical-fixture-value",
        value: "2000000900000001",
        notes:
          "The value carried by protocol/fixtures/billing-ingestion/v1/apple-client-observation.json.",
      },
      {
        id: "beyond-double-precision",
        value: "9007199254740993",
        notes:
          "2^53+1. Round-trips incorrectly through a JavaScript Number or a Dart web int; must survive as a string.",
      },
      {
        id: "uint64-max",
        value: "18446744073709551615",
        notes:
          "UInt64.max, 20 digits. Overflows Int64, Kotlin Long, and Dart int on the native VM. " +
          "StoreKit exposes Transaction.id as UInt64, so this is a representable provider value.",
      },
    ],
  },
};

const path = resolve(here, "billing-reference-vectors.json");
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `Wrote ${document.googlePlayTokenDigest.vectors.length} Google Play digest vectors and ` +
    `${document.appStoreTransactionId.vectors.length} App Store transaction-id vectors to ${path}.`,
);
