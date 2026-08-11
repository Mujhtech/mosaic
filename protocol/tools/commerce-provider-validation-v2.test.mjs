import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCommerceProviderV2Artifacts,
  validateCommerceProviderV2Artifacts,
  validateCommerceProviderV2JsonFormatting,
  validateCommerceProviderV2Record,
} from "./commerce-provider-validation-v2.mjs";
import {
  loadCommerceProviderV1Artifacts,
  validateCommerceProviderV1Artifacts,
} from "./commerce-provider-validation-v1.mjs";
import {
  loadCommerceConfigurationV2Artifacts,
} from "./commerce-configuration-validation-v2.mjs";

function fixture(artifacts, name) {
  const index = artifacts.fixturePaths.findIndex((path) =>
    path.endsWith(`/${name}`),
  );
  assert.notEqual(index, -1, `Missing fixture ${name}`);
  return structuredClone(artifacts.fixtures[index]);
}

test("Commerce Provider v1 remains valid beside v2", () => {
  const v1 = loadCommerceProviderV1Artifacts();
  assert.deepEqual(validateCommerceProviderV1Artifacts(v1), []);
});

test("Commerce Provider v2 canonical artifacts are valid and formatted", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  assert.deepEqual(validateCommerceProviderV2Artifacts(artifacts), []);
  assert.deepEqual(validateCommerceProviderV2JsonFormatting(), []);
});

test("native profiles declare truthful recovery and delayed-delivery capabilities", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  const storeKit = fixture(artifacts, "storekit-profile.json");
  storeKit.payload.recoveryMode = "activePurchaseRecovery";

  const errors = validateCommerceProviderV2Record(
    storeKit,
    artifacts.contractSchema,
  );
  assert.ok(
    errors.some((error) =>
      error.includes("requires supported activePurchaseRecovery capability"),
    ),
  );
  assert.equal(
    fixture(artifacts, "google-play-profile.json").payload.capabilities.find(
      (capability) => capability.name === "deferredPurchases",
    ).support,
    "unsupported",
  );

  const incomplete = fixture(artifacts, "google-play-profile.json");
  incomplete.payload.capabilities.pop();
  assert.ok(
    validateCommerceProviderV2Record(
      incomplete,
      artifacts.contractSchema,
    ).some((error) => error.includes("complete native capability set")),
  );
});

test("delayed success grants access only through an accepted update identity", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  const update = fixture(artifacts, "commerce-update-purchased.json");
  delete update.payload.activeEntitlementKeys;
  assert.ok(
    validateCommerceProviderV2Record(update, artifacts.contractSchema).some(
      (error) => error.includes("requires activeEntitlementKeys"),
    ),
  );

  const empty = fixture(artifacts, "commerce-update-purchased.json");
  empty.payload.activeEntitlementKeys = [];
  assert.ok(
    validateCommerceProviderV2Record(empty, artifacts.contractSchema).some(
      (error) => error.includes("non-empty activeEntitlementKeys"),
    ),
  );

  const acceptance = fixture(artifacts, "commerce-update-accepted.json");
  acceptance.payload.disposition = "deliveryFailed";
  assert.ok(
    validateCommerceProviderV2Record(
      acceptance,
      artifacts.contractSchema,
    ).some((error) => error.includes("requires an error diagnostic")),
  );
});

test("configuration revision is the exact Commerce Configuration content digest", () => {
  const provider = loadCommerceProviderV2Artifacts();
  const configuration = loadCommerceConfigurationV2Artifacts().fixtures.find(
    (candidate) =>
      candidate.configuration.id === "commerce_configuration_google_42",
  );
  const request = fixture(provider, "purchase-request.json");
  assert.equal(
    request.payload.configuration.configurationRevision,
    configuration.configuration.contentDigest,
  );

  request.payload.configuration.configurationRevision = "revision_42";
  assert.ok(
    validateCommerceProviderV2Record(
      request,
      provider.contractSchema,
    ).some((error) => error.includes("must match pattern")),
  );
});

test("all four local acceptance dispositions have closed finalization semantics", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  for (const disposition of ["accepted", "alreadyAccepted"]) {
    const acceptance = fixture(artifacts, "commerce-update-accepted.json");
    acceptance.payload.disposition = disposition;
    assert.deepEqual(
      validateCommerceProviderV2Record(
        acceptance,
        artifacts.contractSchema,
      ),
      [],
    );
  }
  for (const disposition of [
    "rejectedStaleConfiguration",
    "deliveryFailed",
  ]) {
    const acceptance = fixture(artifacts, "commerce-update-accepted.json");
    acceptance.payload.disposition = disposition;
    assert.ok(
      validateCommerceProviderV2Record(
        acceptance,
        artifacts.contractSchema,
      ).some((error) => error.includes("requires an error diagnostic")),
    );
  }

  const unknown = fixture(artifacts, "commerce-update-accepted.json");
  unknown.payload.disposition = "finishAnyway";
  assert.ok(
    validateCommerceProviderV2Record(unknown, artifacts.contractSchema).some(
      (error) => error.includes("must be equal to one of the allowed values"),
    ),
  );
});

test("recovery results require the complete normative field set", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  for (const field of [
    "operationId",
    "providerId",
    "outcome",
    "recoveryMode",
    "completedAt",
    "diagnostics",
  ]) {
    const recovery = fixture(artifacts, "recovery-restored.json");
    delete recovery.payload[field];
    assert.ok(
      validateCommerceProviderV2Record(
        recovery,
        artifacts.contractSchema,
      ).some((error) =>
        error.includes(`must have required property '${field}'`),
      ),
    );
  }
});

test("stale or malformed v2 records fail closed", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  const request = fixture(artifacts, "purchase-request.json");
  request.commerceProviderContractVersion = "1";
  request.payload.configuration.offerToken = "forbidden";
  const errors = validateCommerceProviderV2Record(
    request,
    artifacts.contractSchema,
  );
  assert.ok(errors.some((error) => error.includes("equal to constant")));
  assert.ok(errors.some((error) => error.includes("additional properties")));
});

test("failed Entitlement lookup never becomes authoritative empty access", () => {
  const artifacts = loadCommerceProviderV2Artifacts();
  const outcome = fixture(
    artifacts,
    "entitlement-provider-unavailable.json",
  );
  outcome.payload.activeEntitlementKeys = [];
  assert.ok(
    validateCommerceProviderV2Record(outcome, artifacts.contractSchema).some(
      (error) =>
        error.includes("cannot assert active Entitlements or freshness"),
    ),
  );
});

test("a shrunken Commerce Provider 2 corpus fails instead of conforming over nothing", () => {
  // Regression: the fixture loop reported no errors over an empty array, so a
  // corpus that failed to load read as perfect conformance. Found by
  // tools/check-guard-vacuity.mjs.
  const artifacts = loadCommerceProviderV2Artifacts();
  assert.deepEqual(validateCommerceProviderV2Artifacts(artifacts), []);
  assert.ok(artifacts.fixtures.length > 0);
  for (const shrunken of [[], artifacts.fixtures.slice(0, 1), undefined]) {
    const errors = validateCommerceProviderV2Artifacts({
      ...artifacts,
      fixtures: shrunken,
    });
    assert.ok(
      errors.some((error) => error.includes("below the floor of")),
      `expected a corpus-floor error, got: ${errors.join("; ")}`,
    );
  }
});
