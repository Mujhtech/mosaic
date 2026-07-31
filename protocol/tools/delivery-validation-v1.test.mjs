import assert from "node:assert/strict";
import test from "node:test";

import { releaseMaterialDigest, sha256Digest } from "./delivery-v1-common.mjs";
import {
  decideDeliveryV1Candidate,
  loadDeliveryV1Artifacts,
  validateDeliveryV1Artifacts,
  validateDeliveryV1CapabilityRequest,
  validateDeliveryV1JsonFormatting,
  validateDeliveryV1Release,
} from "./delivery-validation-v1.mjs";

function artifacts() {
  return structuredClone(loadDeliveryV1Artifacts());
}

test("Delivery v1 schemas, compatibility metadata, and canonical fixtures agree", () => {
  const input = artifacts();
  assert.deepEqual(validateDeliveryV1Artifacts(input), []);
  assert.deepEqual(validateDeliveryV1JsonFormatting(), []);
  assert.equal(input.validReleases[1].release.paywallVersions.length, 2);
  assert.equal(input.validReleases[2].release.placements.length, 1);
  assert.ok(input.validReleases[3].release.productReferences.length > 0);
  assert.ok(input.validReleases[4].release.assetReferences.length > 0);
});

test("Delivery v1 digests are canonical and exclude only the release digest field", () => {
  assert.equal(sha256Digest({ b: 2, a: 1 }), sha256Digest({ a: 1, b: 2 }));
  const input = artifacts().validReleases[0];
  const changedDigestOnly = structuredClone(input);
  changedDigestOnly.release.contentDigest = `sha256:${"f".repeat(64)}`;
  assert.equal(releaseMaterialDigest(input), releaseMaterialDigest(changedDigestOnly));
});

test("Delivery v1 rejects every unsupported, malformed, or incomplete release atomically", () => {
  const input = artifacts();
  for (const candidate of input.invalidReleases) {
    assert.notDeepEqual(validateDeliveryV1Release(candidate, input), []);
    assert.equal(
      decideDeliveryV1Candidate({
        candidate,
        lastAcceptedReleaseAvailable: true,
        bundledReleaseAvailable: true,
      }).action,
      "keepLastAcceptedRelease",
    );
  }

  const incompleteSecondPaywall = structuredClone(input.validReleases[1]);
  incompleteSecondPaywall.release.placements.pop();
  assert.notDeepEqual(
    validateDeliveryV1Release(incompleteSecondPaywall, input),
    [],
  );
});

test("Delivery v1 validates digests and complete Product and Asset reference sets", () => {
  const input = artifacts();
  const rich = structuredClone(input.validReleases[3]);
  rich.release.paywallVersions[0].documentDigest = `sha256:${"0".repeat(64)}`;
  assert.match(validateDeliveryV1Release(rich, input).join("\n"), /documentDigest/u);

  const asset = structuredClone(input.validReleases[4]);
  asset.release.assetReferences[0].url = "https://assets.example.com/wrong.webp";
  assert.match(validateDeliveryV1Release(asset, input).join("\n"), /URL/u);
});

test("Capability request metadata is closed and uses exact supported pairs", () => {
  const input = artifacts();
  assert.deepEqual(
    validateDeliveryV1CapabilityRequest(input.capabilityRequest, input),
    [],
  );
  const unknown = structuredClone(input.capabilityRequest);
  unknown.deviceIdentifier = "secret-device-id";
  assert.notDeepEqual(validateDeliveryV1CapabilityRequest(unknown, input), []);

  const duplicate = structuredClone(input.capabilityRequest);
  duplicate.supportedPaywallProtocols[0].capabilities.push(
    duplicate.supportedPaywallProtocols[0].capabilities[0],
  );
  assert.notDeepEqual(validateDeliveryV1CapabilityRequest(duplicate, input), []);
});
