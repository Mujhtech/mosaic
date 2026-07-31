import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCustomerAccessTokenV1Artifacts,
  readCustomerAccessTokenV1Json,
  validateCustomerAccessTokenV1Artifacts,
  validateCustomerAccessTokenV1JsonFormatting,
  validateCustomerAccessTokenV1Record,
} from "./customer-access-token-validation-v1.mjs";

const artifacts = loadCustomerAccessTokenV1Artifacts();

function fixture(name) {
  const path = artifacts.fixturePaths.find((candidate) =>
    candidate.endsWith(`/${name}`),
  );
  assert.ok(path, `Missing fixture ${name}`);
  return readCustomerAccessTokenV1Json(path);
}

test("the committed contract validates clean", () => {
  assert.deepEqual(validateCustomerAccessTokenV1Artifacts(artifacts), []);
  assert.deepEqual(validateCustomerAccessTokenV1JsonFormatting(), []);
});

test("the token is opaque, not signed", () => {
  // An explicit owner-approved deviation from the orchestration prompt's
  // "signed" wording. Pinned so it cannot drift back without a visible change.
  const model = artifacts.compatibilityManifest.tokenModel;
  assert.equal(artifacts.compatibilityManifest.status, "draft");
  assert.equal(model.form, "opaqueRandom");
  assert.equal(model.signed, false);
  assert.equal(model.parseable, false);
  assert.equal(model.entropyBits, 256);
  assert.equal(model.storage, "digestOnly");
  assert.equal(model.digestAlgorithm, "sha256");
  assert.equal(model.revocation, "immediateServerSide");
  assert.equal(model.scopeEvaluation, "serverSideColumns");
});

test("the contract declares no signing vocabulary anywhere", () => {
  const source = JSON.stringify(artifacts.tokenSchema);
  for (const term of ['"alg"', '"kid"', '"jwk"', '"jwks"', '"jws"', '"signature"']) {
    assert.ok(!source.includes(`"properties":{${term}`), `${term} appears as a property`);
  }
  const broken = structuredClone(artifacts);
  broken.tokenSchema = structuredClone(artifacts.tokenSchema);
  broken.tokenSchema.$defs.customerAccessTokenMetadata.properties.kid = {
    type: "string",
  };
  const errors = validateCustomerAccessTokenV1Artifacts(broken);
  assert.ok(
    errors.some((error) => error.includes("no signing vocabulary")),
    `expected a signing-vocabulary error, got: ${errors.join("; ")}`,
  );
});

test("a token never carries Entitlement state", () => {
  // A token that carried entitlements would keep granting them after a refund,
  // for as long as it lived. There is nothing to revoke inside a bearer claim.
  assert.equal(
    artifacts.compatibilityManifest.tokenModel.carriesEntitlementState,
    false,
  );
  const document = fixture("tokens/metadata-active.json");
  document.payload.entitlements = [{ entitlementKey: "pro", state: "active" }];
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(document, artifacts),
    [],
  );

  const broken = structuredClone(artifacts);
  broken.tokenSchema = structuredClone(artifacts.tokenSchema);
  broken.tokenSchema.$defs.customerAccessTokenMetadata.properties.entitlementKeys = {
    type: "array",
  };
  const errors = validateCustomerAccessTokenV1Artifacts(broken);
  assert.ok(
    errors.some((error) => error.includes("never carries access state")),
    `expected an access-state error, got: ${errors.join("; ")}`,
  );
});

test("a token is bound to exactly one customer, Project, and Environment", () => {
  const metadata = artifacts.tokenSchema.$defs.customerAccessTokenMetadata;
  for (const member of ["billingCustomerId", "projectId", "environmentId", "audience"]) {
    assert.ok(metadata.required.includes(member), `${member} is not required`);
  }
  const document = fixture("tokens/metadata-active.json");
  delete document.payload.billingCustomerId;
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(document, artifacts),
    [],
  );
  assert.equal(
    artifacts.compatibilityManifest.readerPolicy.customerMismatch,
    "refuseRequest",
  );
});

test("an issuance request never asserts its own tenant scope", () => {
  // Tenant scope comes from the authenticated secret server key. A request that
  // could name a Project could mint a token into a tenant it does not own.
  const request = artifacts.tokenSchema.$defs.customerAccessTokenIssuanceRequest;
  for (const member of ["projectId", "environmentId"]) {
    assert.ok(
      !(member in request.properties),
      `${member} must not be assertable on an issuance request`,
    );
  }
});

test("token lifetime is bounded", () => {
  const lifetime = artifacts.compatibilityManifest.lifetime;
  assert.equal(lifetime.defaultSeconds, 3600);
  assert.equal(lifetime.maximumSeconds, 86400);
  assert.equal(lifetime.refreshResponsibility, "hostApplicationBackend");

  const document = fixture("tokens/metadata-active.json");
  document.payload.expiresAt = "2026-07-30T12:00:00.000Z";
  const errors = validateCustomerAccessTokenV1Record(document, artifacts);
  assert.ok(
    errors.some((error) => error.includes("maximum")),
    `expected a lifetime error, got: ${errors.join("; ")}`,
  );

  const backwards = fixture("tokens/metadata-active.json");
  backwards.payload.expiresAt = "2026-07-28T11:00:00.000Z";
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(backwards, artifacts),
    [],
  );
});

test("the wire form is contract-owned", () => {
  // Header names must be agreed by the three SDKs, the backend, and any host
  // proxy. Pinning them here makes a rename a contract change.
  const wire = artifacts.compatibilityManifest.wireForm;
  assert.equal(wire.customerTokenHeader, "Authorization");
  assert.equal(wire.customerTokenScheme, "Bearer");
  assert.equal(wire.publicSdkKeyHeader, "Mosaic-SDK-Key");
  assert.equal(wire.publicSdkKeyAloneSufficient, false);
  assert.equal(wire.clockSkewToleranceSeconds, 60);
  assert.equal(wire.clockEvaluatedBy, "server");
});

test("SDK obligations keep the token out of storage and out of logs", () => {
  const obligations = artifacts.compatibilityManifest.sdkObligations;
  assert.equal(obligations.storage, "memoryOnly");
  assert.equal(obligations.parsing, "forbidden");
  assert.equal(obligations.loggingToken, "forbidden");
  assert.equal(obligations.refreshOnUnauthorized, "oncePerGeneration");
  assert.equal(obligations.onLogout, "discardTokenAndClearCache");
  assert.equal(
    obligations.onIdentityChange,
    "bumpGenerationCancelInFlightClearCache",
  );
  // A host backend that cannot mint a token yields unavailable, never inactive.
  assert.equal(obligations.onProviderFailure, "reportUnavailableNeverInactive");
  assert.equal(
    artifacts.compatibilityManifest.readerPolicy.tokenPersistedToDisk,
    "forbidden",
  );
});

test("revocation state is all-or-nothing", () => {
  const revoked = fixture("tokens/metadata-revoked.json");
  assert.equal(revoked.payload.status, "revoked");
  assert.ok(revoked.payload.revokedAt);
  assert.ok(revoked.payload.revocationReason);
  assert.deepEqual(validateCustomerAccessTokenV1Record(revoked, artifacts), []);

  const partial = fixture("tokens/metadata-revoked.json");
  delete partial.payload.revocationReason;
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(partial, artifacts),
    [],
  );

  const contradictory = fixture("tokens/metadata-active.json");
  contradictory.payload.revokedAt = "2026-07-28T12:20:00.000Z";
  contradictory.payload.revocationReason = "operator_revoked";
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(contradictory, artifacts),
    [],
  );
});

test("the token value is opaque and no fixture carries a signed one", () => {
  const pattern = new RegExp(artifacts.tokenSchema.$defs.tokenValue.pattern);
  const issued = fixture("tokens/issuance-result.json");
  assert.match(issued.payload.token, pattern);
  assert.ok(!issued.payload.token.includes("."), "an opaque token has no segments");

  const signed = fixture("tokens/issuance-result.json");
  signed.payload.token =
    "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlLWN1c3RvbWVyLTAwMDEifQ.c2lnbmF0dXJl";
  assert.notDeepEqual(
    validateCustomerAccessTokenV1Record(signed, artifacts),
    [],
  );
});
