import assert from "node:assert/strict";
import test from "node:test";

import {
  decideDeliveryV2Candidate,
  loadDeliveryV2Artifacts,
  validateDeliveryV2Artifacts,
  validateDeliveryV2Release,
} from "./delivery-validation-v2.mjs";

test("Delivery v2 valid, zero-Paywall, capability, projection, and invalid fixtures remain coherent", () => {
  assert.deepEqual(validateDeliveryV2Artifacts(), []);
});

test("invalid advanced semantics reject atomically and preserve last accepted release", () => {
  for (const candidate of loadDeliveryV2Artifacts().invalidReleases) {
    const errors = validateDeliveryV2Release(candidate);
    assert.notDeepEqual(errors, []);
    assert.deepEqual(decideDeliveryV2Candidate({ candidate, lastAcceptedReleaseAvailable: true, bundledReleaseAvailable: true }), {
      action: "keepLastAcceptedRelease",
      errors,
    });
  }
});

test("Delivery v1 projection is limited to an explicit default Paywall", () => {
  for (const testCase of loadDeliveryV2Artifacts().legacyProjection.cases) {
    const actual = testCase.defaultOutcome.type === "paywall" ? "project_default_paywall" : "withhold_v1_candidate";
    assert.equal(actual, testCase.expected, testCase.name);
  }
});

test("Delivery v2 Environment mode is authoritative and production QA overrides reject", () => {
  const artifacts = loadDeliveryV2Artifacts();
  const invalidMode = artifacts.invalidReleases.find((release) => release.release.id === "release_invalid_environment_mode");
  assert.ok(validateDeliveryV2Release(invalidMode).some((error) => error.includes("must be equal to one of the allowed values")));

  const productionOverride = artifacts.invalidReleases.find((release) => release.release.id === "release_invalid_production_qa_override");
  assert.ok(validateDeliveryV2Release(productionOverride).some((error) => error.includes("outside development or staging")));
  const stagingOverride = artifacts.validReleases.find((release) => release.release.id === "release_phase5_staging_qa");
  assert.deepEqual(validateDeliveryV2Release(stagingOverride), []);
});

test("release compatibility rejects both under- and over-declared embedded semantics", () => {
  const invalidReleases = loadDeliveryV2Artifacts().invalidReleases;
  for (const id of ["release_invalid_release_underdeclared_compatibility", "release_invalid_release_overdeclared_compatibility"]) {
    const release = invalidReleases.find((candidate) => candidate.release.id === id);
    assert.ok(validateDeliveryV2Release(release).some((error) => error.includes("exactly equal embedded Rule Set requirements")), id);
  }
});
