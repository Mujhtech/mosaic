import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import {
  billingIngestionV1Root,
  loadBillingIngestionV1Artifacts,
  readBillingIngestionV1Json,
  validateBillingIngestionV1Artifacts,
  validateBillingIngestionV1JsonFormatting,
  validateBillingIngestionV1Record,
} from "./billing-ingestion-validation-v1.mjs";

/**
 * The cross-SDK reference vectors. They live outside `protocol/` because all
 * three SDKs and the backend consume them, but they are verified here: the
 * `google_play_token_digest` derivation is a contract, and a vector that
 * disagrees with the canonical fixture would send five implementations to
 * different values while every schema check still passed.
 */
const referenceVectors = readBillingIngestionV1Json(
  resolve(
    billingIngestionV1Root,
    "../packages/test-fixtures/src/billing-reference-vectors.json",
  ),
);

const artifacts = loadBillingIngestionV1Artifacts();

/**
 * Reloads a fixture from disk so a mutation in one test cannot leak into
 * another through the shared parsed artifacts.
 */
function fixture(name) {
  const path = artifacts.fixturePaths.find((candidate) =>
    candidate.endsWith(`/${name}`),
  );
  assert.ok(path, `Missing fixture ${name}`);
  return readBillingIngestionV1Json(path);
}

test("the committed contract validates clean", () => {
  assert.deepEqual(validateBillingIngestionV1Artifacts(artifacts), []);
  assert.deepEqual(validateBillingIngestionV1JsonFormatting(), []);
});

test("acceptance is never a validation claim", () => {
  const accepted = fixture("responses/accepted-for-validation.json");
  assert.equal(accepted.payload.status, "accepted_for_validation");

  const statuses = artifacts.submissionResponseSchema.$defs.observationSubmissionResult.oneOf.map(
    (branch) => branch.properties.status.const,
  );
  assert.deepEqual(statuses, [
    "accepted_for_validation",
    "duplicate",
    "permanently_rejected",
    "retryable_failure",
  ]);
  for (const status of statuses) {
    assert.doesNotMatch(status, /^(validated|verified|confirmed|entitled)$/);
  }
});

test("a transaction fact can never carry client authority", () => {
  const document = fixture("transaction-facts/apple-initial-purchase-fact.json");
  document.payload.sourceAuthority = "client_observation";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("a transaction fact is always sandbox or production", () => {
  const document = fixture("transaction-facts/apple-initial-purchase-fact.json");
  document.payload.storeEnvironment = "unclassified";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("a client observation cannot claim another source authority", () => {
  const document = fixture("apple-client-observation.json");
  document.payload.sourceAuthority = "provider_notification";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("a reference kind must match its store platform", () => {
  const document = fixture("apple-client-observation.json");
  document.payload.storePlatform = "google_play";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("ambiguity requires at least two candidates and never resolves", () => {
  const document = fixture("validation/quarantined-ambiguous-product.json");
  document.payload.productResolution.candidateMappingIds = ["fixture-mapping-0003"];
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("quarantine never yields a transaction fact", () => {
  const document = fixture("validation/quarantined-unknown-product.json");
  const fact = fixture("transaction-facts/apple-initial-purchase-fact.json");
  document.payload.transactionFact = fact.payload;
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("a transient failure is always retryable and its exhaustion is arithmetic", () => {
  const document = fixture("validation/transient-failure-provider-unavailable.json");
  const notRetryable = structuredClone(document);
  notRetryable.payload.retry.retryable = false;
  assert.notDeepEqual(
    validateBillingIngestionV1Record(notRetryable, artifacts),
    [],
  );

  const contradictory = structuredClone(document);
  contradictory.payload.retry.attempt = 8;
  contradictory.payload.retry.maxAttempts = 8;
  contradictory.payload.retry.exhausted = false;
  assert.notDeepEqual(
    validateBillingIngestionV1Record(contradictory, artifacts),
    [],
  );
});

test("a fact cannot be recorded before it occurred", () => {
  const document = fixture("transaction-facts/apple-initial-purchase-fact.json");
  document.payload.recordedAt = "2020-01-01T00:00:00.000Z";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("no billing record may name entitlement or subscription vocabulary", () => {
  const document = fixture("transaction-facts/apple-initial-purchase-fact.json");
  document.payload.entitlementActive = true;
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("no fixture carries a signed-payload-shaped value", () => {
  const jws = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  for (const document of artifacts.validFixtures) {
    for (const value of strings(document)) {
      assert.doesNotMatch(value, jws);
    }
  }
});

test("a purchase token may travel only on a trusted server observation", () => {
  const trusted = fixture("trusted-server-observation.json");
  assert.equal(trusted.payload.purchaseToken, "fixture-google-purchase-token-0002");
  assert.deepEqual(validateBillingIngestionV1Record(trusted, artifacts), []);

  // A public SDK observation has no such property at all.
  const client = fixture("google-client-observation.json");
  client.payload.purchaseToken = "fixture-google-purchase-token-0001";
  assert.notDeepEqual(validateBillingIngestionV1Record(client, artifacts), []);

  // Not on any other server authority, and not on Apple.
  const notification = structuredClone(trusted);
  notification.payload.sourceAuthority = "provider_notification";
  notification.payload.trustBasis = "mutual_tls";
  assert.notDeepEqual(
    validateBillingIngestionV1Record(notification, artifacts),
    [],
  );
});

test("a purchase token must digest to its own transaction reference", () => {
  const document = fixture("trusted-server-observation.json");
  assert.equal(
    createHash("sha256").update(document.payload.purchaseToken, "utf8").digest("hex"),
    document.payload.transactionReference.value,
  );

  // The record must not be able to validate one purchase and be filed under
  // another. No schema rule can express this.
  document.payload.purchaseToken = "fixture-google-purchase-token-0001";
  assert.notDeepEqual(validateBillingIngestionV1Record(document, artifacts), []);
});

test("every Google Play digest vector is the SHA-256 of its UTF-8 token", () => {
  const { algorithm, derivation, vectors } = referenceVectors.googlePlayTokenDigest;
  assert.equal(derivation, "sha256_utf8_lowercase_hex");
  assert.equal(algorithm.prefix, null);

  const digests = new Set();
  for (const vector of vectors) {
    assert.equal(
      Buffer.byteLength(vector.token, "utf8"),
      vector.tokenUtf8ByteLength,
      `${vector.id} declares the wrong UTF-8 byte length`,
    );
    assert.equal(
      createHash("sha256").update(vector.token, "utf8").digest("hex"),
      vector.digest,
      `${vector.id} digest is not SHA-256 over the UTF-8 token`,
    );
    assert.match(vector.digest, /^[a-f0-9]{64}$/);
    digests.add(vector.digest);
  }
  assert.equal(digests.size, vectors.length, "distinct tokens must hash distinctly");

  // The vector that catches a UTF-16 or Latin-1 implementation must actually
  // contain non-ASCII, or it catches nothing.
  const nonAscii = vectors.find((vector) => vector.id === "non-ascii-token");
  assert.ok(nonAscii, "the non-ASCII encoding vector is missing");
  // eslint-disable-next-line no-control-regex
  assert.match(nonAscii.token, /[^\x00-\x7F]/);
});

test("reference vectors match the contract patterns and the canonical fixtures", () => {
  const defs = artifacts.observationSchema.$defs;
  const digestPattern = new RegExp(
    defs.transactionReference.oneOf[1].properties.value.pattern,
  );
  const decimalPattern = new RegExp(
    defs.transactionReference.oneOf[0].properties.value.pattern,
  );
  const decimalMaxLength =
    defs.transactionReference.oneOf[0].properties.value.maxLength;

  for (const vector of referenceVectors.googlePlayTokenDigest.vectors) {
    assert.match(vector.digest, digestPattern);
  }
  for (const vector of referenceVectors.appStoreTransactionId.vectors) {
    assert.match(vector.value, decimalPattern);
    assert.ok(vector.value.length <= decimalMaxLength);
  }

  const googleCanonical = referenceVectors.googlePlayTokenDigest.vectors.find(
    (vector) => vector.id === "canonical-fixture-token",
  );
  assert.equal(
    fixture("google-client-observation.json").payload.transactionReference.value,
    googleCanonical.digest,
    "the canonical vector and the canonical Google fixture have drifted apart",
  );

  const appleCanonical = referenceVectors.appStoreTransactionId.vectors.find(
    (vector) => vector.id === "canonical-fixture-value",
  );
  assert.equal(
    fixture("apple-client-observation.json").payload.transactionReference.value,
    appleCanonical.value,
    "the canonical vector and the canonical Apple fixture have drifted apart",
  );

  // UInt64.max must remain representable: an SDK that parses rather than
  // carries the value is exactly what this vector exists to fail.
  const uint64Max = referenceVectors.appStoreTransactionId.vectors.find(
    (vector) => vector.id === "uint64-max",
  );
  assert.equal(uint64Max.value, (2n ** 64n - 1n).toString());
  assert.match(uint64Max.value, decimalPattern);
});

test("the manifest is born as a draft and pins every frozen rule", () => {
  const manifest = artifacts.compatibilityManifest;
  assert.equal(manifest.status, "draft");
  assert.deepEqual(manifest.readerPolicy, {
    unknownContractVersion: "rejectRecord",
    unknownRecordType: "rejectRecord",
    unknownField: "rejectRecord",
    unknownOutcome: "rejectRecord",
    unknownQuarantineReason: "rejectRecord",
    unknownSourceAuthority: "rejectRecord",
    unknownTransactionType: "rejectRecord",
    acceptedSubmission: "neverTreatAsValidated",
    unresolvedProduct: "quarantineNeverGuess",
    unclassifiedStoreEnvironment: "neverAggregateWithProduction",
    clientAuthoritativeFact: "forbidden",
    entitlementInference: "forbidden",
    factMutation: "forbidden",
    rawProviderCredential: "forbidden",
    rawProviderError: "forbidden",
    purchaseTokenTransport: "trustedServerObservationOnly",
  });
  assert.deepEqual(
    manifest.referenceKinds.map((entry) => [entry.referenceKind, entry.derivation]),
    [
      ["app_store_transaction_id", "raw_decimal_provider_value"],
      ["google_play_token_digest", "sha256_utf8_lowercase_hex"],
      ["google_play_order_id", "raw_provider_value"],
    ],
  );
});
