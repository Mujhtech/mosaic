import assert from "node:assert/strict";
import test from "node:test";

import { releaseMaterialDigest, sha256Digest } from "./delivery-common.mjs";
import {
  decideDeliveryV3Candidate,
  loadDeliveryV3Artifacts,
  validateDeliveryV3Artifacts,
  validateDeliveryV3CapabilityRequest,
  validateDeliveryV3JsonFormatting,
  validateDeliveryV3Release,
} from "./delivery-validation-v3.mjs";

function artifacts() {
  return structuredClone(loadDeliveryV3Artifacts());
}

function release(input, id) {
  const found = [...input.validReleases, ...input.invalidReleases].find(
    (candidate) => candidate.release.id === id,
  );
  assert.ok(found, `expected release ${id}`);
  return found;
}

test("Delivery v3 schemas, compatibility metadata, and every fixture agree", () => {
  assert.deepEqual(validateDeliveryV3Artifacts(), []);
  assert.deepEqual(validateDeliveryV3JsonFormatting(), []);
});

test("the release carries Paywall Protocol 0.4 documents", () => {
  const input = artifacts();
  const advanced = release(input, "release_advanced");
  assert.ok(advanced.release.paywallVersions.length > 0);
  for (const version of advanced.release.paywallVersions) {
    assert.equal(version.protocolVersion, "0.4");
    assert.equal(version.document.schemaVersion, "0.4");
  }
  assert.equal(advanced.release.compatibility.paywallProtocols[0].version, "0.4");
  assert.equal(
    input.capabilityRequest.supportedPaywallProtocols[0].version,
    "0.4",
  );
  assert.deepEqual(input.manifest.supportedPaywallProtocols, ["0.4"]);
});

test("release digests are canonical and exclude only the digest field", () => {
  assert.equal(sha256Digest({ b: 2, a: 1 }), sha256Digest({ a: 1, b: 2 }));
  const input = artifacts().validReleases[0];
  const changedDigestOnly = structuredClone(input);
  changedDigestOnly.release.contentDigest = `sha256:${"f".repeat(64)}`;
  assert.equal(
    releaseMaterialDigest(input),
    releaseMaterialDigest(changedDigestOnly),
  );
});

test("every invalid candidate rejects atomically and preserves last accepted release", () => {
  const input = artifacts();
  for (const candidate of input.invalidReleases) {
    const errors = validateDeliveryV3Release(candidate, input);
    assert.notDeepEqual(errors, [], candidate.release.id);
    assert.deepEqual(
      decideDeliveryV3Candidate({
        candidate,
        lastAcceptedReleaseAvailable: true,
        bundledReleaseAvailable: true,
      }),
      { action: "keepLastAcceptedRelease", errors },
    );
  }
  assert.equal(
    decideDeliveryV3Candidate({
      candidate: input.invalidReleases[0],
      lastAcceptedReleaseAvailable: false,
      bundledReleaseAvailable: false,
    }).action,
    "configurationUnavailable",
  );
});

test("embedded Paywall material is validated inside the envelope", () => {
  const input = artifacts();
  const digestMismatch = release(input, "release_invalid_paywall_material");
  assert.match(
    validateDeliveryV3Release(digestMismatch, input).join("\n"),
    /documentDigest/u,
  );

  const rich = structuredClone(release(input, "release_rich"));
  rich.release.assetReferences[0].url = "https://assets.example.com/wrong.webp";
  assert.match(validateDeliveryV3Release(rich, input).join("\n"), /URL/u);

  // A document that is schema-valid but semantically invalid must be caught
  // here rather than only by the standalone paywall gate: the release is the
  // only place the document and its digest travel together.
  const brokenDocument = structuredClone(release(input, "release_rich"));
  brokenDocument.release.paywallVersions[0].document.compatibility.requiredCapabilities =
    brokenDocument.release.paywallVersions[0].document.compatibility.requiredCapabilities.filter(
      (capability) => capability.name !== "component.text",
    );
  assert.ok(
    validateDeliveryV3Release(brokenDocument, input).some((error) =>
      error.includes("missing required capability component.text"),
    ),
  );
});

test("Environment mode is authoritative and production QA overrides reject", () => {
  const input = artifacts();
  assert.ok(
    validateDeliveryV3Release(
      release(input, "release_invalid_environment_mode"),
      input,
    ).some((error) => error.includes("must be equal to one of the allowed values")),
  );
  assert.ok(
    validateDeliveryV3Release(
      release(input, "release_invalid_production_qa_override"),
      input,
    ).some((error) => error.includes("outside development or staging")),
  );
  assert.deepEqual(
    validateDeliveryV3Release(release(input, "release_staging_qa"), input),
    [],
  );
});

test("release compatibility rejects both under- and over-declared embedded semantics", () => {
  const input = artifacts();
  for (const id of [
    "release_invalid_release_underdeclared_compatibility",
    "release_invalid_release_overdeclared_compatibility",
  ]) {
    assert.ok(
      validateDeliveryV3Release(release(input, id), input).some((error) =>
        error.includes("exactly equal embedded Rule Set requirements"),
      ),
      id,
    );
  }

  const overdeclaredExperiment = structuredClone(
    release(input, "release_experiment"),
  );
  overdeclaredExperiment.release.compatibility.experimentAssignmentContracts[0].requiredFeatures.push(
    "override.qa",
  );
  overdeclaredExperiment.release.contentDigest = releaseMaterialDigest(
    overdeclaredExperiment,
  );
  assert.ok(
    validateDeliveryV3Release(overdeclaredExperiment, input).some((error) =>
      error.includes("exactly equal embedded Assignment semantics"),
    ),
  );
});

test("Control and Variant Products remain anchored to exact release material", () => {
  const input = artifacts();
  const candidate = structuredClone(release(input, "release_experiment"));
  candidate.release.experimentAssignments[0].controlPaywallVersionId =
    "paywall_version_fallback";
  assert.ok(
    validateDeliveryV3Release(candidate, input).some((error) =>
      error.includes("Control anchor"),
    ),
  );
});

test("an Experiment Version's stable Experiment must belong to its Group Version", () => {
  const input = artifacts();
  const candidate = structuredClone(release(input, "release_experiment"));
  candidate.release.experimentAssignments[0].mutualExclusionGroup.members[0].experimentId =
    "experiment_unrelated";
  assert.ok(
    validateDeliveryV3Release(candidate, input).some((error) =>
      error.includes("not a member"),
    ),
  );
});

test("capability request metadata is closed and uses exact supported pairs", () => {
  const input = artifacts();
  assert.deepEqual(
    validateDeliveryV3CapabilityRequest(input.capabilityRequest, input),
    [],
  );

  const unknown = structuredClone(input.capabilityRequest);
  unknown.deviceIdentifier = "secret-device-id";
  assert.notDeepEqual(
    validateDeliveryV3CapabilityRequest(unknown, input),
    [],
  );

  const duplicate = structuredClone(input.capabilityRequest);
  duplicate.supportedPaywallProtocols[0].capabilities.push(
    duplicate.supportedPaywallProtocols[0].capabilities[0],
  );
  assert.notDeepEqual(
    validateDeliveryV3CapabilityRequest(duplicate, input),
    [],
  );

  // There is one Configuration Delivery version, so a client advertising an
  // older one gets nothing rather than an older representation.
  const legacy = structuredClone(input.capabilityRequest);
  legacy.supportedConfigurationDeliveryVersions = ["1"];
  assert.deepEqual(
    validateDeliveryV3CapabilityRequest(legacy, input),
    [],
    "the request itself stays well-formed; version selection is the server's",
  );
  assert.ok(!input.manifest.supportedPaywallProtocols.includes("0.3"));
});
