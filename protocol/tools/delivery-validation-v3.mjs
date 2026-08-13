/**
 * Configuration Delivery v3, the only Configuration Delivery contract.
 *
 * Every rule is checked here directly. Earlier revisions of this file validated
 * v3 by projecting it back to v2 and v2 back to v1, which made the contract's
 * meaning depend on two predecessors it no longer has; the checks those
 * projections performed are now inline.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { releaseMaterialDigest, sha256Digest } from "./delivery-common.mjs";
import {
  loadExperimentAssignmentV1Artifacts,
  validateExperimentAssignmentV1,
} from "./experiment-assignment-validation-v1.mjs";
import {
  loadDecisionV1Artifacts,
  validateDecisionV1,
} from "./placement-decision-validation-v1.mjs";
import { loadProtocolV04Artifacts, validateProtocolV04 } from "./validation-v0.4.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const validFixtureNames = [
  "advanced-release.json",
  "experiment-release.json",
  "no-paywall-release.json",
  "rich-release.json",
  "staging-qa-override-release.json",
];

const invalidFixtureNames = [
  "duplicate-priority.json",
  "fallback-cycle.json",
  "incompatible-source-operator.json",
  "incomplete-release.json",
  "invalid-condition-type.json",
  "invalid-environment-mode.json",
  "malformed-allocation.json",
  "malformed-release.json",
  "missing-unavailable-fallback.json",
  "overdeclared-features.json",
  "paywall-material-digest.json",
  "production-qa-override.json",
  "qa-override-over-24h.json",
  "release-overdeclared-compatibility.json",
  "release-underdeclared-compatibility.json",
  "underdeclared-features.json",
  "unsupported-contract-version.json",
  "unsupported-experiment-contract.json",
  "unsupported-operator.json",
  "unsupported-paywall-protocol.json",
];

export const deliveryV3Paths = Object.freeze({
  releaseSchema: resolve(root, "schema/configuration-delivery/v3/release.schema.json"),
  capabilityRequestSchema: resolve(root, "schema/configuration-delivery/v3/capability-request.schema.json"),
  manifestSchema: resolve(root, "schema/configuration-delivery/v3/compatibility-manifest.schema.json"),
  manifest: resolve(root, "compatibility/configuration-delivery/v3.json"),
  canonicalFixture: resolve(root, "fixtures/configuration-delivery/v3/experiment-release.json"),
  validFixtures: validFixtureNames.map((name) => resolve(root, "fixtures/configuration-delivery/v3", name)),
  capabilityFixture: resolve(root, "fixtures/configuration-delivery/v3/capability-request.json"),
  invalidFixtures: invalidFixtureNames.map((name) => resolve(root, "fixtures/configuration-delivery/v3/invalid", name)),
});

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

// Every release in the corpus validates its embedded Paywall documents against
// the same immutable artifacts. Re-reading the whole 0.4 corpus per release is
// the difference between a fast gate and a slow one.
let paywallArtifacts = null;
const protocolArtifacts = () => (paywallArtifacts ??= loadProtocolV04Artifacts());
const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
const schemaErrors = (label, errors = []) =>
  errors.map((error) => `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
const capabilityKey = (capability) => `${capability.name}@${capability.version}`;

function duplicates(entries, field, label, errors) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry[field])) errors.push(`${label} contains duplicate ${field} ${entry[field]}`);
    seen.add(entry[field]);
  }
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function requireSameSet(errors, actual, expected, label) {
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);
  if (missing.length > 0) errors.push(`${label} is missing ${missing.join(", ")}`);
  if (unexpected.length > 0) errors.push(`${label} contains unexpected ${unexpected.join(", ")}`);
}

export function loadDeliveryV3Artifacts() {
  return {
    releaseSchema: read(deliveryV3Paths.releaseSchema),
    capabilityRequestSchema: read(deliveryV3Paths.capabilityRequestSchema),
    manifestSchema: read(deliveryV3Paths.manifestSchema),
    manifest: read(deliveryV3Paths.manifest),
    validReleases: deliveryV3Paths.validFixtures.map(read),
    capabilityRequest: read(deliveryV3Paths.capabilityFixture),
    invalidReleases: deliveryV3Paths.invalidFixtures.map(read),
  };
}

function validators(artifacts) {
  const protocol = protocolArtifacts();
  const decision = loadDecisionV1Artifacts();
  const experiment = loadExperimentAssignmentV1Artifacts();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schema of [protocol.paywallSchema, decision.schema, experiment.schema]) ajv.addSchema(schema);
  return {
    release: ajv.compile(artifacts.releaseSchema),
    capability: ajv.compile(artifacts.capabilityRequestSchema),
    manifest: ajv.compile(artifacts.manifestSchema),
  };
}

/**
 * The Paywall material a release carries, checked inside the envelope.
 *
 * A release is the only place a Paywall document, its digest, its Product
 * references, and its hosted Asset bindings appear together, so this is the
 * only place their agreement can be checked.
 */
function validatePaywallMaterial(errors, release, paywall) {
  const expectedProducts = new Set();
  const expectedAssets = new Set();
  const expectedCapabilities = new Set();
  const assetById = new Map(release.assetReferences.map((asset) => [asset.id, asset]));

  for (const version of release.paywallVersions) {
    if (version.protocolVersion !== version.document.schemaVersion) {
      errors.push(`Paywall Version ${version.id} protocolVersion does not match its document`);
    }
    if (version.paywallId !== version.document.id) {
      errors.push(`Paywall Version ${version.id} paywallId does not match document id`);
    }
    if (version.documentDigest !== sha256Digest(version.document)) {
      errors.push(`Paywall Version ${version.id} documentDigest does not match`);
    }
    errors.push(
      ...validateProtocolV04({ ...paywall, document: version.document }).map(
        (error) => `Paywall Version ${version.id}: ${error}`,
      ),
    );

    const documentProducts = new Set(version.document.products.map((product) => product.productId));
    requireSameSet(
      errors,
      new Set(version.productReferenceIds),
      documentProducts,
      `Paywall Version ${version.id} productReferenceIds`,
    );
    for (const productId of documentProducts) expectedProducts.add(productId);
    for (const capability of version.document.compatibility.requiredCapabilities) {
      expectedCapabilities.add(capabilityKey(capability));
    }

    duplicates(version.assetBindings, "documentAssetId", `Paywall Version ${version.id} assetBindings`, errors);
    duplicates(version.assetBindings, "assetReferenceId", `Paywall Version ${version.id} assetBindings`, errors);
    const remoteAssetById = new Map(
      version.document.assets
        .filter((asset) => asset.source.type === "remote")
        .map((asset) => [asset.id, asset]),
    );
    requireSameSet(
      errors,
      new Set(version.assetBindings.map((binding) => binding.documentAssetId)),
      new Set(remoteAssetById.keys()),
      `Paywall Version ${version.id} remote Asset bindings`,
    );
    for (const binding of version.assetBindings) {
      expectedAssets.add(binding.assetReferenceId);
      const documentAsset = remoteAssetById.get(binding.documentAssetId);
      const releaseAsset = assetById.get(binding.assetReferenceId);
      if (!documentAsset) continue;
      if (!releaseAsset) {
        errors.push(`Paywall Version ${version.id} references unknown Asset ${binding.assetReferenceId}`);
        continue;
      }
      if (releaseAsset.kind !== documentAsset.type) {
        errors.push(`Asset ${releaseAsset.id} kind does not match document Asset`);
      }
      if (releaseAsset.url !== documentAsset.source.url) {
        errors.push(`Asset ${releaseAsset.id} URL does not match document Asset URL`);
      }
    }
  }

  requireSameSet(
    errors,
    new Set(release.assetReferences.map((asset) => asset.id)),
    expectedAssets,
    "release Asset references",
  );
  for (const asset of release.assetReferences) {
    if (!asset.mediaType.startsWith(`${asset.kind}/`)) {
      errors.push(`Asset ${asset.id} mediaType does not match kind`);
    }
  }
  requireSameSet(
    errors,
    new Set(release.compatibility.paywallProtocols[0].requiredCapabilities.map(capabilityKey)),
    expectedCapabilities,
    "release required Paywall capabilities",
  );
  return expectedProducts;
}

function collectDecisionReferences(decision) {
  const paywalls = new Set();
  const products = new Set();
  const entitlements = new Set();
  const outcomes = [
    decision.ruleSet.defaultOutcome,
    ...decision.ruleSet.rules.map((rule) => rule.outcome),
    ...decision.ruleSet.fallbacks.map((fallback) => fallback.outcome),
    ...decision.ruleSet.qaOverrides.map((override) => override.outcome),
  ];
  for (const outcome of outcomes) {
    if (outcome.type === "paywall") paywalls.add(outcome.paywallVersionId);
  }
  for (const rule of decision.ruleSet.rules) {
    const visit = (node) => {
      if (node.type === "condition") {
        if (["product_availability", "product_readiness"].includes(node.source.kind)) {
          products.add(node.source.productId);
        }
        if (node.source.kind === "entitlement_state") entitlements.add(node.source.key);
        return;
      }
      if (node.child) visit(node.child);
      for (const child of node.children ?? []) visit(child);
    };
    visit(rule.conditions);
  }
  return { paywalls, products, entitlements };
}

function validatePlacementMaterial(errors, release) {
  const placementKeys = new Set();
  const placementIds = new Set();
  const ruleSetIds = new Set();
  const referencedPaywalls = new Set();
  const referencedProducts = new Set();
  const referencedEntitlements = new Set();
  const features = new Set();
  const algorithms = new Set();

  for (const decision of release.placementDecisions) {
    const ruleSet = decision.ruleSet;
    for (const [set, value, label] of [
      [placementKeys, ruleSet.placementKey, "Placement key"],
      [placementIds, ruleSet.placementId, "Placement ID"],
      [ruleSetIds, ruleSet.id, "Rule Set ID"],
    ]) {
      if (set.has(value)) errors.push(`${label} ${value} is duplicated`);
      set.add(value);
    }
    if (ruleSet.projectId !== release.projectId) {
      errors.push(`Rule Set ${ruleSet.id} Project does not match release`);
    }
    if (ruleSet.environmentId !== release.environment.id || ruleSet.environmentKey !== release.environment.key) {
      errors.push(`Rule Set ${ruleSet.id} Environment does not match release`);
    }
    errors.push(...validateDecisionV1(decision).map((error) => `Rule Set ${ruleSet.id}: ${error}`));
    const references = collectDecisionReferences(decision);
    for (const value of references.paywalls) referencedPaywalls.add(value);
    for (const value of references.products) referencedProducts.add(value);
    for (const value of references.entitlements) referencedEntitlements.add(value);
    for (const value of ruleSet.compatibility.requiredFeatures) features.add(value);
    for (const value of ruleSet.compatibility.bucketingAlgorithms) algorithms.add(value);
    if (ruleSet.qaOverrides.length > 0 && !["development", "staging"].includes(release.environment.mode)) {
      errors.push(`Rule Set ${ruleSet.id} contains a QA override outside development or staging`);
    }
  }

  const declared = release.compatibility.placementDecisionContracts[0];
  if (!sameSet(features, new Set(declared.requiredFeatures)) || !sameSet(algorithms, new Set(declared.bucketingAlgorithms))) {
    errors.push("release decision compatibility must exactly equal embedded Rule Set requirements");
  }
  return { referencedPaywalls, referencedProducts, referencedEntitlements };
}

function validateExperimentMaterial(errors, release) {
  const assignments = release.experimentAssignments;
  const ids = new Set();
  const versionIds = new Set();
  const assignmentFeatures = new Set();
  const algorithms = new Set();
  const schedulePolicies = new Set();
  const paywalls = new Set(release.paywallVersions.map((version) => version.id));
  const paywallById = new Map(release.paywallVersions.map((version) => [version.id, version]));
  const products = new Set(release.productReferences.map((product) => product.id));
  const placements = new Set(release.placementDecisions.map((decision) => decision.ruleSet.placementId));
  const groupSnapshots = new Map();
  const decisionPaywalls = new Map(
    release.placementDecisions.map((decision) => {
      const ruleSet = decision.ruleSet;
      const outcomes = [
        ruleSet.defaultOutcome,
        ...ruleSet.rules.map((rule) => rule.outcome),
        ...ruleSet.fallbacks.map((fallback) => fallback.outcome),
        ...ruleSet.qaOverrides.map((override) => override.outcome),
      ];
      return [
        ruleSet.placementId,
        new Set(outcomes.filter((outcome) => outcome.type === "paywall").map((outcome) => outcome.paywallVersionId)),
      ];
    }),
  );

  for (const assignment of assignments) {
    errors.push(
      ...validateExperimentAssignmentV1({ experimentAssignmentVersion: "1", assignment }).map(
        (error) => `${assignment.experimentVersionId}: ${error}`,
      ),
    );
    if (ids.has(assignment.experimentId)) errors.push(`duplicate Experiment ID ${assignment.experimentId}`);
    ids.add(assignment.experimentId);
    if (versionIds.has(assignment.experimentVersionId)) {
      errors.push(`duplicate Experiment Version ID ${assignment.experimentVersionId}`);
    }
    versionIds.add(assignment.experimentVersionId);
    if (assignment.projectId !== release.projectId || assignment.environmentId !== release.environment.id) {
      errors.push(`${assignment.experimentVersionId} tenant scope differs from release`);
    }
    if (!placements.has(assignment.placementId)) {
      errors.push(`${assignment.experimentVersionId} Placement is not in the release`);
    }
    if (!decisionPaywalls.get(assignment.placementId)?.has(assignment.controlPaywallVersionId)) {
      errors.push(`${assignment.experimentVersionId} Control anchor is not an exact Paywall outcome of its Placement`);
    }
    if (assignment.mutualExclusionGroup) {
      const group = assignment.mutualExclusionGroup;
      const groupKey = `${group.id}:${group.versionId}`;
      const normalized = JSON.stringify({
        ...group,
        members: [...group.members].sort((left, right) => left.rangeStart - right.rangeStart),
      });
      if (groupSnapshots.has(groupKey) && groupSnapshots.get(groupKey) !== normalized) {
        errors.push(`Group Version ${groupKey} has inconsistent immutable member snapshots`);
      }
      groupSnapshots.set(groupKey, normalized);
      if (!group.members.some((member) => member.experimentId === assignment.experimentId)) {
        errors.push(`${assignment.experimentVersionId} stable Experiment ID is not a member of Group Version ${groupKey}`);
      }
    }
    for (const variant of assignment.variants) {
      if (!paywalls.has(variant.paywallVersionId)) {
        errors.push(`${assignment.experimentVersionId} references absent Paywall Version ${variant.paywallVersionId}`);
      }
      for (const productId of variant.compatibility.requiredProductIds) {
        if (!products.has(productId)) {
          errors.push(`${assignment.experimentVersionId} references absent Product ${productId}`);
        }
      }
      const expectedProducts = new Set(paywallById.get(variant.paywallVersionId)?.productReferenceIds ?? []);
      if (!sameSet(expectedProducts, new Set(variant.compatibility.requiredProductIds))) {
        errors.push(`${assignment.experimentVersionId} Variant Product requirements must exactly equal its Paywall Version references`);
      }
    }
    for (const value of assignment.compatibility.requiredFeatures) assignmentFeatures.add(value);
    for (const value of assignment.compatibility.bucketingAlgorithms) algorithms.add(value);
    for (const value of assignment.compatibility.schedulePolicies) schedulePolicies.add(value);
    if (assignment.qaOverrides.length > 0 && !["development", "staging"].includes(release.environment.mode)) {
      errors.push(`${assignment.experimentVersionId} contains a production QA override`);
    }
  }

  const declared = release.compatibility.experimentAssignmentContracts[0];
  if (
    !sameSet(assignmentFeatures, new Set(declared.requiredFeatures)) ||
    !sameSet(algorithms, new Set(declared.bucketingAlgorithms)) ||
    !sameSet(schedulePolicies, new Set(declared.schedulePolicies))
  ) {
    errors.push("release Experiment compatibility must exactly equal embedded Assignment semantics");
  }
}

export function validateDeliveryV3Release(envelope, artifacts = loadDeliveryV3Artifacts()) {
  const validate = validators(artifacts).release;
  if (!validate(envelope)) return schemaErrors("release", validate.errors);

  const errors = [];
  const release = envelope.release;
  if (release.contentDigest !== releaseMaterialDigest(envelope)) {
    errors.push("release contentDigest does not match canonical release material");
  }

  for (const [entries, field, label] of [
    [release.paywallVersions, "id", "Paywall Versions"],
    [release.paywallVersions, "paywallId", "Paywall Versions"],
    [release.productReferences, "id", "Product references"],
    [release.entitlementReferences, "id", "Entitlement references"],
    [release.entitlementReferences, "key", "Entitlement references"],
    [release.assetReferences, "id", "Asset references"],
  ]) {
    duplicates(entries, field, label, errors);
  }

  const placement = validatePlacementMaterial(errors, release);
  const paywallProducts = validatePaywallMaterial(errors, release, protocolArtifacts());

  const actualPaywalls = new Set(release.paywallVersions.map((version) => version.id));
  if (!sameSet(placement.referencedPaywalls, actualPaywalls)) {
    errors.push("Paywall Versions must exactly equal decision Paywall references");
  }
  const expectedProducts = new Set([...placement.referencedProducts, ...paywallProducts]);
  requireSameSet(
    errors,
    new Set(release.productReferences.map((product) => product.id)),
    expectedProducts,
    "release Product references",
  );
  if (!sameSet(placement.referencedEntitlements, new Set(release.entitlementReferences.map((entry) => entry.key)))) {
    errors.push("Entitlement references must exactly equal decision Entitlement keys");
  }
  if (release.paywallVersions.length === 0 && release.assetReferences.length > 0) {
    errors.push("zero-Paywall release cannot contain Asset references");
  }

  validateExperimentMaterial(errors, release);
  return errors;
}

export function validateDeliveryV3CapabilityRequest(request, artifacts = loadDeliveryV3Artifacts()) {
  const validate = validators(artifacts).capability;
  if (!validate(request)) return schemaErrors("capability request", validate.errors);
  const errors = [];
  duplicates(request.supportedPaywallProtocols, "version", "supported Paywall protocols", errors);
  for (const protocol of request.supportedPaywallProtocols) {
    duplicates(protocol.capabilities, "name", "supported capabilities", errors);
  }
  return errors;
}

export function validateDeliveryV3Artifacts(artifacts = loadDeliveryV3Artifacts()) {
  const compiled = validators(artifacts);
  const errors = [];
  if (!compiled.manifest(artifacts.manifest)) {
    errors.push(...schemaErrors("manifest", compiled.manifest.errors));
  }
  for (const [index, release] of artifacts.validReleases.entries()) {
    errors.push(
      ...validateDeliveryV3Release(release, artifacts).map(
        (error) => `valid fixture ${validFixtureNames[index]}: ${error}`,
      ),
    );
  }
  errors.push(...validateDeliveryV3CapabilityRequest(artifacts.capabilityRequest, artifacts));
  for (const [index, release] of artifacts.invalidReleases.entries()) {
    if (validateDeliveryV3Release(release, artifacts).length === 0) {
      errors.push(`invalid fixture ${invalidFixtureNames[index]} was accepted`);
    }
  }
  const directory = dirname(deliveryV3Paths.manifest);
  for (const path of [
    artifacts.manifest.releaseSchema,
    artifacts.manifest.capabilityRequestSchema,
    artifacts.manifest.canonicalFixture,
  ]) {
    if (!existsSync(resolve(directory, path))) errors.push(`manifest path does not exist: ${path}`);
  }
  return errors;
}

export function validateDeliveryV3JsonFormatting() {
  const paths = [
    deliveryV3Paths.releaseSchema,
    deliveryV3Paths.capabilityRequestSchema,
    deliveryV3Paths.manifestSchema,
    deliveryV3Paths.manifest,
    deliveryV3Paths.capabilityFixture,
    ...deliveryV3Paths.validFixtures,
    ...deliveryV3Paths.invalidFixtures,
  ];
  return paths.flatMap((path) =>
    readFileSync(path, "utf8") === `${JSON.stringify(read(path), null, 2)}\n`
      ? []
      : [`${relative(root, path)} is not canonical JSON`],
  );
}

export function decideDeliveryV3Candidate({ candidate, lastAcceptedReleaseAvailable, bundledReleaseAvailable }) {
  const errors = validateDeliveryV3Release(candidate);
  if (errors.length === 0) return { action: "acceptRelease", errors: [] };
  if (lastAcceptedReleaseAvailable) return { action: "keepLastAcceptedRelease", errors };
  if (bundledReleaseAvailable) return { action: "loadBundledRelease", errors };
  return { action: "configurationUnavailable", errors };
}
