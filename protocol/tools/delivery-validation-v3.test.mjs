import assert from "node:assert/strict";
import test from "node:test";

import { decideDeliveryV3Candidate, loadDeliveryV3Artifacts, validateDeliveryV3Artifacts, validateDeliveryV3Release } from "./delivery-validation-v3.mjs";

test("Delivery v3 atomically carries the exact v2 snapshot and Experiment Assignment v1", () => {
  assert.deepEqual(validateDeliveryV3Artifacts(), []);
});

test("malformed or unsupported Experiment candidates preserve last accepted release", () => {
  for (const candidate of loadDeliveryV3Artifacts().invalidReleases) {
    const errors = validateDeliveryV3Release(candidate);
    assert.notDeepEqual(errors, []);
    assert.equal(decideDeliveryV3Candidate({ candidate, lastAcceptedReleaseAvailable: true, bundledReleaseAvailable: true }).action, "keepLastAcceptedRelease");
  }
});

test("overdeclared Experiment compatibility is rejected", () => {
  const artifacts = loadDeliveryV3Artifacts();
  const candidate = structuredClone(artifacts.validReleases[0]);
  candidate.release.compatibility.experimentAssignmentContracts[0].requiredFeatures.push("override.qa");
  candidate.release.contentDigest = "sha256:" + "0".repeat(64);
  assert.ok(validateDeliveryV3Release(candidate, artifacts).some((error) => error.includes("exactly equal")));
});

test("Control and Variant Products remain anchored to exact release material", () => {
  const artifacts = loadDeliveryV3Artifacts();
  const candidate = structuredClone(artifacts.validReleases[0]);
  candidate.release.experimentAssignments[0].controlPaywallVersionId = "paywall_version_fallback";
  assert.ok(validateDeliveryV3Release(candidate, artifacts).some((error) => error.includes("Control anchor")));
});

test("Delivery pins an Experiment Version whose stable Experiment belongs to the selected Group Version", () => {
  const artifacts = loadDeliveryV3Artifacts();
  const candidate = structuredClone(artifacts.validReleases[0]);
  candidate.release.experimentAssignments[0].mutualExclusionGroup.members[0].experimentId = "experiment_unrelated";
  assert.ok(validateDeliveryV3Release(candidate, artifacts).some((error) => error.includes("must belong") || error.includes("not a member")));
});
