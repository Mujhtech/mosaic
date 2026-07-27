import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { releaseMaterialDigest } from "./delivery-v1-common.mjs";
import { loadDeliveryV1Artifacts } from "./delivery-validation-v1.mjs";
import { loadDeliveryV2Artifacts, validateDeliveryV2Release } from "./delivery-validation-v2.mjs";
import { loadExperimentAssignmentV1Artifacts, validateExperimentAssignmentV1 } from "./experiment-assignment-validation-v1.mjs";
import { loadDecisionV1Artifacts } from "./placement-decision-validation-v1.mjs";
import { loadProtocolV02Artifacts } from "./validation-v0.2.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
export const deliveryV3Paths = Object.freeze({
  releaseSchema: resolve(root, "schema/configuration-delivery/v3/release.schema.json"),
  capabilityRequestSchema: resolve(root, "schema/configuration-delivery/v3/capability-request.schema.json"),
  manifestSchema: resolve(root, "schema/configuration-delivery/v3/compatibility-manifest.schema.json"),
  manifest: resolve(root, "compatibility/configuration-delivery/v3.json"),
  validFixture: resolve(root, "fixtures/configuration-delivery/v3/experiment-release.json"),
  capabilityFixture: resolve(root, "fixtures/configuration-delivery/v3/capability-request.json"),
  projectionFixture: resolve(root, "fixtures/configuration-delivery/v3/legacy-v2-projection.json"),
  invalidFixtures: ["malformed-allocation.json", "unsupported-experiment-contract.json"].map((name) => resolve(root, "fixtures/configuration-delivery/v3/invalid", name)),
});
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sameSet = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));
const schemaErrors = (label, errors = []) => errors.map((error) => `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);

export function loadDeliveryV3Artifacts() {
  return {
    releaseSchema: read(deliveryV3Paths.releaseSchema), capabilityRequestSchema: read(deliveryV3Paths.capabilityRequestSchema),
    manifestSchema: read(deliveryV3Paths.manifestSchema), manifest: read(deliveryV3Paths.manifest),
    validReleases: [read(deliveryV3Paths.validFixture)], capabilityRequest: read(deliveryV3Paths.capabilityFixture),
    projection: read(deliveryV3Paths.projectionFixture), invalidReleases: deliveryV3Paths.invalidFixtures.map(read),
  };
}

function validators(artifacts) {
  const protocol = loadProtocolV02Artifacts(); const v1 = loadDeliveryV1Artifacts(); const v2 = loadDeliveryV2Artifacts();
  const decision = loadDecisionV1Artifacts(); const experiment = loadExperimentAssignmentV1Artifacts();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schema of [protocol.paywallSchema, decision.schema, v1.releaseSchema, v1.capabilityRequestSchema, experiment.schema, v2.releaseSchema, v2.capabilityRequestSchema]) ajv.addSchema(schema);
  return { release: ajv.compile(artifacts.releaseSchema), capability: ajv.compile(artifacts.capabilityRequestSchema), manifest: ajv.compile(artifacts.manifestSchema) };
}

function projectV2(envelope) {
  const projection = structuredClone(envelope);
  projection.configurationDeliveryVersion = "2";
  delete projection.release.experimentAssignments;
  delete projection.release.compatibility.experimentAssignmentContracts;
  projection.release.contentDigest = releaseMaterialDigest(projection);
  return projection;
}

export function validateDeliveryV3Release(envelope, artifacts = loadDeliveryV3Artifacts()) {
  const validate = validators(artifacts).release;
  if (!validate(envelope)) return schemaErrors("release", validate.errors);
  const errors = [];
  if (envelope.release.contentDigest !== releaseMaterialDigest(envelope)) errors.push("release contentDigest does not match canonical release material");
  errors.push(...validateDeliveryV2Release(projectV2(envelope)).map((error) => `Delivery v2 snapshot: ${error}`));
  const assignments = envelope.release.experimentAssignments;
  const ids = new Set(); const versionIds = new Set(); const assignmentFeatures = new Set(); const algorithms = new Set(); const schedulePolicies = new Set();
  const paywalls = new Set(envelope.release.paywallVersions.map((version) => version.id));
  const paywallById = new Map(envelope.release.paywallVersions.map((version) => [version.id, version]));
  const products = new Set(envelope.release.productReferences.map((product) => product.id));
  const placements = new Set(envelope.release.placementDecisions.map((decision) => decision.ruleSet.placementId));
  const groupSnapshots = new Map();
  const decisionPaywalls = new Map(envelope.release.placementDecisions.map((decision) => {
    const ruleSet = decision.ruleSet;
    const outcomes = [ruleSet.defaultOutcome, ...ruleSet.rules.map((rule) => rule.outcome), ...ruleSet.fallbacks.map((fallback) => fallback.outcome), ...ruleSet.qaOverrides.map((override) => override.outcome)];
    return [ruleSet.placementId, new Set(outcomes.filter((outcome) => outcome.type === "paywall").map((outcome) => outcome.paywallVersionId))];
  }));
  for (const assignment of assignments) {
    const wrapped = { experimentAssignmentVersion: "1", assignment };
    errors.push(...validateExperimentAssignmentV1(wrapped).map((error) => `${assignment.experimentVersionId}: ${error}`));
    if (ids.has(assignment.experimentId)) errors.push(`duplicate Experiment ID ${assignment.experimentId}`); ids.add(assignment.experimentId);
    if (versionIds.has(assignment.experimentVersionId)) errors.push(`duplicate Experiment Version ID ${assignment.experimentVersionId}`); versionIds.add(assignment.experimentVersionId);
    if (assignment.projectId !== envelope.release.projectId || assignment.environmentId !== envelope.release.environment.id) errors.push(`${assignment.experimentVersionId} tenant scope differs from release`);
    if (!placements.has(assignment.placementId)) errors.push(`${assignment.experimentVersionId} Placement is not in the release`);
    if (!decisionPaywalls.get(assignment.placementId)?.has(assignment.controlPaywallVersionId)) errors.push(`${assignment.experimentVersionId} Control anchor is not an exact Paywall outcome of its Placement`);
    if (assignment.mutualExclusionGroup) {
      const group = assignment.mutualExclusionGroup;
      const groupKey = `${group.id}:${group.versionId}`;
      const normalized = JSON.stringify({
        ...group,
        members: [...group.members].sort((left, right) => left.rangeStart - right.rangeStart),
      });
      if (groupSnapshots.has(groupKey) && groupSnapshots.get(groupKey) !== normalized) errors.push(`Group Version ${groupKey} has inconsistent immutable member snapshots`);
      groupSnapshots.set(groupKey, normalized);
      if (!group.members.some((member) => member.experimentId === assignment.experimentId)) errors.push(`${assignment.experimentVersionId} stable Experiment ID is not a member of Group Version ${groupKey}`);
    }
    for (const variant of assignment.variants) {
      if (!paywalls.has(variant.paywallVersionId)) errors.push(`${assignment.experimentVersionId} references absent Paywall Version ${variant.paywallVersionId}`);
      for (const productId of variant.compatibility.requiredProductIds) if (!products.has(productId)) errors.push(`${assignment.experimentVersionId} references absent Product ${productId}`);
      const expectedProducts = new Set(paywallById.get(variant.paywallVersionId)?.productReferenceIds ?? []);
      if (!sameSet(expectedProducts, new Set(variant.compatibility.requiredProductIds))) errors.push(`${assignment.experimentVersionId} Variant Product requirements must exactly equal its Paywall Version references`);
    }
    for (const value of assignment.compatibility.requiredFeatures) assignmentFeatures.add(value);
    for (const value of assignment.compatibility.bucketingAlgorithms) algorithms.add(value);
    for (const value of assignment.compatibility.schedulePolicies) schedulePolicies.add(value);
    if (assignment.qaOverrides.length > 0 && !["development", "staging"].includes(envelope.release.environment.mode)) errors.push(`${assignment.experimentVersionId} contains a production QA override`);
  }
  const declared = envelope.release.compatibility.experimentAssignmentContracts[0];
  if (!sameSet(assignmentFeatures, new Set(declared.requiredFeatures)) || !sameSet(algorithms, new Set(declared.bucketingAlgorithms)) || !sameSet(schedulePolicies, new Set(declared.schedulePolicies))) errors.push("release Experiment compatibility must exactly equal embedded Assignment semantics");
  return errors;
}

export function validateDeliveryV3CapabilityRequest(request, artifacts = loadDeliveryV3Artifacts()) {
  const validate = validators(artifacts).capability;
  return validate(request) ? [] : schemaErrors("capability request", validate.errors);
}

export function validateDeliveryV3Artifacts(artifacts = loadDeliveryV3Artifacts()) {
  const compiled = validators(artifacts); const errors = [];
  if (!compiled.manifest(artifacts.manifest)) errors.push(...schemaErrors("manifest", compiled.manifest.errors));
  for (const release of artifacts.validReleases) errors.push(...validateDeliveryV3Release(release, artifacts));
  errors.push(...validateDeliveryV3CapabilityRequest(artifacts.capabilityRequest, artifacts));
  for (const release of artifacts.invalidReleases) if (validateDeliveryV3Release(release, artifacts).length === 0) errors.push(`invalid release ${release.release.id} was accepted`);
  if (artifacts.projection.expectedPlacementBehavior !== "unchanged_normal_placement") errors.push("legacy projection changes normal Placement behavior");
  const directory = dirname(deliveryV3Paths.manifest);
  for (const path of [artifacts.manifest.releaseSchema, artifacts.manifest.capabilityRequestSchema, artifacts.manifest.canonicalFixture, artifacts.manifest.legacyProjectionFixture]) if (!existsSync(resolve(directory, path))) errors.push(`manifest path does not exist: ${path}`);
  return errors;
}

export function validateDeliveryV3JsonFormatting() {
  const paths = [deliveryV3Paths.releaseSchema, deliveryV3Paths.capabilityRequestSchema, deliveryV3Paths.manifestSchema, deliveryV3Paths.manifest, deliveryV3Paths.validFixture, deliveryV3Paths.capabilityFixture, deliveryV3Paths.projectionFixture, ...deliveryV3Paths.invalidFixtures];
  return paths.flatMap((path) => readFileSync(path, "utf8") === `${JSON.stringify(read(path), null, 2)}\n` ? [] : [`${relative(root, path)} is not canonical JSON`]);
}

export function decideDeliveryV3Candidate({ candidate, lastAcceptedReleaseAvailable, bundledReleaseAvailable }) {
  const errors = validateDeliveryV3Release(candidate);
  if (errors.length === 0) return { action: "acceptRelease", errors: [] };
  if (lastAcceptedReleaseAvailable) return { action: "keepLastAcceptedRelease", errors };
  if (bundledReleaseAvailable) return { action: "loadBundledRelease", errors };
  return { action: "configurationUnavailable", errors };
}
