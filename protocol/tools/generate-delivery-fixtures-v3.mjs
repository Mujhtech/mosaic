/**
 * The Configuration Delivery v3 fixture corpus.
 *
 * v3 is the only Configuration Delivery contract, so its corpus is generated
 * directly from the Paywall Protocol 0.4 corpus and the Placement Decision v1
 * evaluator-conformance Rule Set rather than by patching a predecessor's
 * fixtures. The Placement Decision invalid fixtures are written here too,
 * because each invalid Rule Set is the same material as the release that
 * embeds it and two hand-kept copies of one Rule Set drift.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, releaseMaterialDigest, sha256Digest } from "./delivery-common.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const write = (path, value) => {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const evaluator = read("fixtures/placement-decision/v1/evaluator-conformance.json");
const navigation = read("fixtures/v0.4/navigation-only.json");
const complete = read("fixtures/v0.4/complete-paywall.json");

const hostedAssetId = (documentAssetId) => `hosted_${documentAssetId.replaceAll("-", "_")}`;

function sortedCapabilities(documents) {
  const capabilities = new Map();
  for (const document of documents) {
    for (const capability of document.compatibility.requiredCapabilities) {
      capabilities.set(`${capability.name}@${capability.version}`, capability);
    }
  }
  return [...capabilities.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function assetReferences(document) {
  return document.assets
    .filter((asset) => asset.source.type === "remote")
    .map((asset, index) => ({
      id: hostedAssetId(asset.id),
      kind: asset.type,
      mediaType: asset.type === "image" ? "image/webp" : "video/mp4",
      byteLength: asset.type === "image" ? 24576 + index : 1048576 + index,
      contentDigest: sha256Digest({ fixtureAssetBytes: hostedAssetId(asset.id) }),
      url: asset.source.url,
    }));
}

function versionRecord({ id, paywallId, document }) {
  return {
    id,
    paywallId,
    protocolVersion: "0.4",
    documentDigest: sha256Digest(document),
    document,
    productReferenceIds: document.products.map((product) => product.productId),
    assetBindings: document.assets
      .filter((asset) => asset.source.type === "remote")
      .map((asset) => ({
        documentAssetId: asset.id,
        assetReferenceId: hostedAssetId(asset.id),
      })),
  };
}

function paywallVersion(id, paywallId) {
  const document = structuredClone(navigation);
  document.id = paywallId;
  return versionRecord({ id, paywallId, document });
}

const paywalls = [
  paywallVersion("paywall_version_fallback", "paywall_fallback"),
  paywallVersion("paywall_version_student", "paywall_student"),
  paywallVersion("paywall_version_ios", "paywall_ios"),
];

const productReferences = [
  { id: "product_export_pro", type: "subscription", fallbackDisplayName: "Export Pro", readiness: "ready" },
];

function compatibility(decisions, versions, assignments) {
  const requiredFeatures = [...new Set(decisions.flatMap((decision) => decision.ruleSet.compatibility.requiredFeatures))].sort();
  const bucketingAlgorithms = [...new Set(decisions.flatMap((decision) => decision.ruleSet.compatibility.bucketingAlgorithms))].sort();
  return {
    placementDecisionContracts: [{ version: "1", requiredFeatures, bucketingAlgorithms }],
    paywallProtocols: [{ version: "0.4", requiredCapabilities: sortedCapabilities(versions.map((version) => version.document)) }],
    acceptance: "atomic",
    experimentAssignmentContracts: [{
      version: "1",
      requiredFeatures: [...new Set(assignments.flatMap((assignment) => assignment.compatibility.requiredFeatures))].sort(),
      bucketingAlgorithms: [...new Set(assignments.flatMap((assignment) => assignment.compatibility.bucketingAlgorithms))].sort(),
      schedulePolicies: [...new Set(assignments.flatMap((assignment) => assignment.compatibility.schedulePolicies))].sort(),
    }],
  };
}

function envelope({
  id,
  number,
  decisions,
  versions,
  products,
  entitlements = [],
  assignments = [],
  assets = [],
  environment = { id: "environment_production", key: "production", mode: "production" },
}) {
  const result = {
    configurationDeliveryVersion: "3",
    release: {
      id,
      number,
      projectId: "project_alpha",
      environment,
      publishedAt: "2026-07-26T12:00:00.000Z",
      contentDigest: `sha256:${"0".repeat(64)}`,
      compatibility: compatibility(decisions, versions, assignments),
      placementDecisions: decisions,
      paywallVersions: versions,
      productReferences: products,
      entitlementReferences: entitlements,
      assetReferences: assets,
      experimentAssignments: assignments,
    },
  };
  result.release.contentDigest = releaseMaterialDigest(result);
  return result;
}

const advanced = envelope({
  id: "release_advanced",
  number: 12,
  decisions: [evaluator.decision],
  versions: paywalls,
  products: productReferences,
  entitlements: [{ id: "entitlement_pro", key: "pro" }],
});
write("fixtures/configuration-delivery/v3/advanced-release.json", advanced);

const noPaywallDecision = structuredClone(evaluator.decision);
Object.assign(noPaywallDecision.ruleSet, {
  id: "ruleset_onboarding_complete",
  placementId: "placement_onboarding_complete",
  placementKey: "onboarding_complete",
  rules: [],
  fallbacks: [],
  defaultOutcome: { type: "no_paywall" },
  compatibility: { requiredFeatures: ["outcome.no_paywall"], bucketingAlgorithms: [] },
});
write("fixtures/configuration-delivery/v3/no-paywall-release.json", envelope({
  id: "release_no_paywall", number: 13, decisions: [noPaywallDecision], versions: [], products: [], entitlements: [],
}));

function qaOverrideDecision({ over24Hours = false } = {}) {
  const decision = structuredClone(noPaywallDecision);
  decision.ruleSet.qaOverrides = [{
    id: "override_export_qa",
    selectorDigest: `sha256:${"a".repeat(64)}`,
    safeLabel: "QA export override",
    startsAt: "2026-07-26T12:00:00.000Z",
    expiresAt: over24Hours ? "2026-07-27T12:00:00.001Z" : "2026-07-27T12:00:00.000Z",
    outcome: { type: "no_paywall" },
  }];
  decision.ruleSet.compatibility.requiredFeatures = ["outcome.no_paywall", "override.qa"];
  return decision;
}

const stagingQaDecision = qaOverrideDecision();
Object.assign(stagingQaDecision.ruleSet, { environmentId: "environment_staging", environmentKey: "staging" });
write("fixtures/configuration-delivery/v3/staging-qa-override-release.json", envelope({
  id: "release_staging_qa", number: 14, decisions: [stagingQaDecision], versions: [], products: [], entitlements: [],
  environment: { id: "environment_staging", key: "staging", mode: "staging" },
}));

const assignmentEnvelope = read("fixtures/experiment-assignment/v1/running-ab.json");
const assignment = structuredClone(assignmentEnvelope.assignment);
Object.assign(assignment, {
  placementId: "placement_export_pdf",
  controlPaywallVersionId: "paywall_version_ios",
  variants: [
    { ...assignment.variants[0], paywallId: "paywall_ios", paywallVersionId: "paywall_version_ios", compatibility: { requiredProductIds: [], requiredProviderCapabilities: [] } },
    { ...assignment.variants[1], paywallId: "paywall_student", paywallVersionId: "paywall_version_student", compatibility: { requiredProductIds: [], requiredProviderCapabilities: [] } },
  ],
});

const experimentRelease = envelope({
  id: "release_experiment",
  number: 15,
  decisions: [evaluator.decision],
  versions: paywalls,
  products: productReferences,
  entitlements: [{ id: "entitlement_pro", key: "pro" }],
  assignments: [assignment],
});
write("fixtures/configuration-delivery/v3/experiment-release.json", experimentRelease);

write("fixtures/configuration-delivery/v3/capability-request.json", {
  platform: "flutter",
  sdkVersion: "0.4.0",
  supportedConfigurationDeliveryVersions: ["3"],
  supportedPaywallProtocols: [{ version: "0.4", capabilities: sortedCapabilities([complete]).map(({ name }) => ({ name, version: "0.4" })) }],
  supportedPlacementDecisionContracts: ["1"],
  supportedDecisionFeatures: evaluator.decision.ruleSet.compatibility.requiredFeatures,
  supportedBucketingAlgorithms: ["sha256_length_prefixed_v1"],
  supportedExperimentAssignmentContracts: ["1"],
  supportedExperimentFeatures: assignment.compatibility.requiredFeatures,
  supportedExperimentBucketingAlgorithms: assignment.compatibility.bucketingAlgorithms,
  supportedExperimentSchedulePolicies: assignment.compatibility.schedulePolicies,
  applicationVersion: "2.10.0",
});

const incompatibleSourceOperator = structuredClone(evaluator.decision);
incompatibleSourceOperator.ruleSet.id = "ruleset_invalid_incompatible_source_operator";
incompatibleSourceOperator.ruleSet.rules[0].conditions.operator = "greater_than";
incompatibleSourceOperator.ruleSet.rules[0].conditions.operand = { type: "string", value: "active" };
incompatibleSourceOperator.ruleSet.compatibility.requiredFeatures = [...new Set(incompatibleSourceOperator.ruleSet.compatibility.requiredFeatures.concat("operator.greater_than"))].sort();

const missingUnavailableFallback = structuredClone(evaluator.decision);
missingUnavailableFallback.ruleSet.id = "ruleset_invalid_missing_unavailable_fallback";
missingUnavailableFallback.ruleSet.rules[2].outcome.unavailableFallbackKey = "not_defined";

const underdeclaredFeatures = structuredClone(evaluator.decision);
underdeclaredFeatures.ruleSet.id = "ruleset_invalid_underdeclared_features";
underdeclaredFeatures.ruleSet.compatibility.requiredFeatures = underdeclaredFeatures.ruleSet.compatibility.requiredFeatures.filter((feature) => feature !== "source.device.platform");

const overdeclaredFeatures = structuredClone(evaluator.decision);
overdeclaredFeatures.ruleSet.id = "ruleset_invalid_overdeclared_features";
overdeclaredFeatures.ruleSet.compatibility.requiredFeatures = [...overdeclaredFeatures.ruleSet.compatibility.requiredFeatures, "condition.any"].sort();

const overlongQaOverride = qaOverrideDecision({ over24Hours: true });
overlongQaOverride.ruleSet.id = "ruleset_invalid_qa_override_over_24h";

for (const [name, invalidDecision] of [
  ["unsupported-operator", read("fixtures/placement-decision/v1/invalid/unsupported-operator.json")],
  ["invalid-condition-type", read("fixtures/placement-decision/v1/invalid/invalid-condition-type.json")],
  ["duplicate-priority", read("fixtures/placement-decision/v1/invalid/duplicate-priority.json")],
  ["fallback-cycle", read("fixtures/placement-decision/v1/invalid/fallback-cycle.json")],
  ["incompatible-source-operator", incompatibleSourceOperator],
  ["missing-unavailable-fallback", missingUnavailableFallback],
  ["underdeclared-features", underdeclaredFeatures],
  ["overdeclared-features", overdeclaredFeatures],
  ["qa-override-over-24h", overlongQaOverride],
]) {
  write(`fixtures/placement-decision/v1/invalid/${name}.json`, invalidDecision);
  invalidDecision.ruleSet.projectId = "project_alpha";
  invalidDecision.ruleSet.environmentId = "environment_production";
  invalidDecision.ruleSet.environmentKey = "production";
  const referencesPaywalls = [
    invalidDecision.ruleSet.defaultOutcome,
    ...invalidDecision.ruleSet.rules.map((rule) => rule.outcome),
    ...invalidDecision.ruleSet.fallbacks.map((fallback) => fallback.outcome),
    ...invalidDecision.ruleSet.qaOverrides.map((override) => override.outcome),
  ].some((outcome) => outcome.type === "paywall");
  write(`fixtures/configuration-delivery/v3/invalid/${name}.json`, envelope({
    id: `release_invalid_${name.replaceAll("-", "_")}`,
    number: 99,
    decisions: [invalidDecision],
    versions: referencesPaywalls ? paywalls : [],
    products: referencesPaywalls ? productReferences : [],
    entitlements: invalidDecision.ruleSet.rules.some((rule) => canonicalJson(rule.conditions).includes("entitlement_state")) ? [{ id: "entitlement_pro", key: "pro" }] : [],
  }));
}

for (const [name, featureMutation] of [
  ["release-underdeclared-compatibility", (features) => features.filter((feature) => feature !== "source.device.platform")],
  ["release-overdeclared-compatibility", (features) => [...features, "condition.any"].sort()],
]) {
  const invalid = structuredClone(advanced);
  invalid.release.id = `release_invalid_${name.replaceAll("-", "_")}`;
  invalid.release.compatibility.placementDecisionContracts[0].requiredFeatures = featureMutation(invalid.release.compatibility.placementDecisionContracts[0].requiredFeatures);
  invalid.release.contentDigest = releaseMaterialDigest(invalid);
  write(`fixtures/configuration-delivery/v3/invalid/${name}.json`, invalid);
}

write("fixtures/configuration-delivery/v3/invalid/production-qa-override.json", envelope({
  id: "release_invalid_production_qa_override", number: 99, decisions: [qaOverrideDecision()], versions: [], products: [], entitlements: [],
}));

const invalidEnvironmentMode = structuredClone(advanced);
invalidEnvironmentMode.release.id = "release_invalid_environment_mode";
invalidEnvironmentMode.release.environment.mode = "preview";
invalidEnvironmentMode.release.contentDigest = releaseMaterialDigest(invalidEnvironmentMode);
write("fixtures/configuration-delivery/v3/invalid/invalid-environment-mode.json", invalidEnvironmentMode);

const malformedAllocation = structuredClone(experimentRelease);
malformedAllocation.release.id = "release_invalid_allocation";
malformedAllocation.release.experimentAssignments[0].variants[0].rangeEnd = 6000;
malformedAllocation.release.contentDigest = releaseMaterialDigest(malformedAllocation);
write("fixtures/configuration-delivery/v3/invalid/malformed-allocation.json", malformedAllocation);

const unsupportedExperimentContract = structuredClone(experimentRelease);
unsupportedExperimentContract.release.id = "release_invalid_unsupported_experiment_contract";
unsupportedExperimentContract.release.compatibility.experimentAssignmentContracts[0].version = "99";
unsupportedExperimentContract.release.contentDigest = releaseMaterialDigest(unsupportedExperimentContract);
write("fixtures/configuration-delivery/v3/invalid/unsupported-experiment-contract.json", unsupportedExperimentContract);

// A release whose embedded Paywall material is internally inconsistent. The
// paywall rules are checked inside the delivery envelope rather than only
// beside it, and a corpus with no such case would never reach that check.
const incompletePaywallMaterial = structuredClone(advanced);
incompletePaywallMaterial.release.id = "release_invalid_paywall_material";
incompletePaywallMaterial.release.paywallVersions[0].documentDigest = `sha256:${"b".repeat(64)}`;
incompletePaywallMaterial.release.contentDigest = releaseMaterialDigest(incompletePaywallMaterial);
write("fixtures/configuration-delivery/v3/invalid/paywall-material-digest.json", incompletePaywallMaterial);

const richDocument = structuredClone(complete);
const completeVersion = versionRecord({ id: "paywall_version_complete", paywallId: richDocument.id, document: richDocument });
const richDecision = structuredClone(noPaywallDecision);
Object.assign(richDecision.ruleSet, {
  id: "ruleset_upgrade_prompt",
  placementId: "placement_upgrade_prompt",
  placementKey: "upgrade_prompt",
  defaultOutcome: { type: "paywall", paywallVersionId: completeVersion.id },
  compatibility: { requiredFeatures: ["outcome.paywall"], bucketingAlgorithms: [] },
});
const richRelease = envelope({
  id: "release_rich",
  number: 16,
  decisions: [richDecision],
  versions: [completeVersion],
  products: richDocument.products.map((product) => ({
    id: product.productId,
    type: product.productId.includes("lifetime") ? "one_time_non_consumable" : "subscription",
    fallbackDisplayName: product.label.default,
    readiness: "ready",
  })),
  assets: assetReferences(richDocument),
});
write("fixtures/configuration-delivery/v3/rich-release.json", richRelease);

const incompleteProducts = structuredClone(richRelease);
incompleteProducts.release.id = "release_invalid_incomplete_products";
incompleteProducts.release.productReferences.pop();
incompleteProducts.release.contentDigest = releaseMaterialDigest(incompleteProducts);
write("fixtures/configuration-delivery/v3/invalid/incomplete-release.json", incompleteProducts);

const unsupportedContractVersion = structuredClone(advanced);
unsupportedContractVersion.configurationDeliveryVersion = "2";
write("fixtures/configuration-delivery/v3/invalid/unsupported-contract-version.json", unsupportedContractVersion);

const unsupportedPaywallProtocol = structuredClone(advanced);
unsupportedPaywallProtocol.release.id = "release_invalid_unsupported_paywall_protocol";
unsupportedPaywallProtocol.release.compatibility.paywallProtocols[0].version = "0.5";
unsupportedPaywallProtocol.release.paywallVersions[0].protocolVersion = "0.5";
unsupportedPaywallProtocol.release.contentDigest = releaseMaterialDigest(unsupportedPaywallProtocol);
write("fixtures/configuration-delivery/v3/invalid/unsupported-paywall-protocol.json", unsupportedPaywallProtocol);

const malformedRelease = structuredClone(advanced);
malformedRelease.release.internalAuditActor = "actor_secret";
write("fixtures/configuration-delivery/v3/invalid/malformed-release.json", malformedRelease);
