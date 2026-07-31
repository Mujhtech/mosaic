import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseMaterialDigest, sha256Digest } from "./delivery-v1-common.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const write = (path, value) => {
  const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const evaluator = read("fixtures/placement-decision/v1/evaluator-conformance.json");
const v1 = read("fixtures/configuration-delivery/v1/valid-release.json");

function paywallVersion(id, paywallId) {
  const version = structuredClone(v1.release.paywallVersions[0]);
  version.id = id; version.paywallId = paywallId; version.document.id = paywallId;
  version.documentDigest = sha256Digest(version.document);
  return version;
}

const paywalls = [
  paywallVersion("paywall_version_fallback", "paywall_fallback"),
  paywallVersion("paywall_version_student", "paywall_student"),
  paywallVersion("paywall_version_ios", "paywall_ios"),
];
const productReferences = v1.release.productReferences.map((product) => ({ ...product, readiness: "ready" }));
if (!productReferences.some((product) => product.id === "product_export_pro")) {
  productReferences.push({ id: "product_export_pro", type: "subscription", fallbackDisplayName: "Export Pro", readiness: "ready" });
}

function compatibility(decisions, versions) {
  const requiredFeatures = [...new Set(decisions.flatMap((decision) => decision.ruleSet.compatibility.requiredFeatures))].sort();
  const bucketingAlgorithms = [...new Set(decisions.flatMap((decision) => decision.ruleSet.compatibility.bucketingAlgorithms))].sort();
  const requiredCapabilities = [...new Map(versions.flatMap((version) => version.document.compatibility.requiredCapabilities).map((capability) => [`${capability.name}@${capability.version}`, capability])).values()].sort((left, right) => left.name.localeCompare(right.name));
  return { placementDecisionContracts: [{ version: "1", requiredFeatures, bucketingAlgorithms }], paywallProtocols: [{ version: "0.2", requiredCapabilities }], acceptance: "atomic" };
}

function envelope({ id, number, decisions, versions, products, entitlements = [], environment = { id: "environment_production", key: "production", mode: "production" } }) {
  const result = {
    configurationDeliveryVersion: "2",
    release: {
      id, number, projectId: "project_alpha", environment,
      publishedAt: "2026-07-26T12:00:00.000Z", contentDigest: `sha256:${"0".repeat(64)}`,
      compatibility: compatibility(decisions, versions), placementDecisions: decisions, paywallVersions: versions,
      productReferences: products, entitlementReferences: entitlements, assetReferences: versions.length > 0 ? v1.release.assetReferences : [],
    },
  };
  result.release.contentDigest = releaseMaterialDigest(result);
  return result;
}

const advanced = envelope({
  id: "release_phase5_advanced", number: 12, decisions: [evaluator.decision], versions: paywalls,
  products: productReferences, entitlements: [{ id: "entitlement_pro", key: "pro" }],
});
write("fixtures/configuration-delivery/v2/advanced-release.json", advanced);

const noPaywallDecision = structuredClone(evaluator.decision);
Object.assign(noPaywallDecision.ruleSet, { id: "ruleset_onboarding_complete", placementId: "placement_onboarding_complete", placementKey: "onboarding_complete", rules: [], fallbacks: [], defaultOutcome: { type: "no_paywall" }, compatibility: { requiredFeatures: ["outcome.no_paywall"], bucketingAlgorithms: [] } });
write("fixtures/configuration-delivery/v2/no-paywall-release.json", envelope({ id: "release_phase5_no_paywall", number: 13, decisions: [noPaywallDecision], versions: [], products: [], entitlements: [] }));

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
write("fixtures/configuration-delivery/v2/staging-qa-override-release.json", envelope({
  id: "release_phase5_staging_qa", number: 14, decisions: [stagingQaDecision], versions: [], products: [], entitlements: [],
  environment: { id: "environment_staging", key: "staging", mode: "staging" },
}));

write("fixtures/configuration-delivery/v2/capability-request.json", {
  platform: "flutter", sdkVersion: "0.3.0", supportedConfigurationDeliveryVersions: ["1", "2"],
  supportedPaywallProtocols: v1.release.compatibility.paywallProtocols.map((protocol) => ({ version: protocol.version, capabilities: protocol.requiredCapabilities })),
  supportedPlacementDecisionContracts: ["1"], supportedDecisionFeatures: evaluator.decision.ruleSet.compatibility.requiredFeatures,
  supportedBucketingAlgorithms: ["sha256_length_prefixed_v1"], applicationVersion: "2.10.0",
});

write("fixtures/configuration-delivery/v2/legacy-projection.json", {
  cases: [
    { name: "explicit default Paywall is safe", defaultOutcome: { type: "paywall", paywallVersionId: "paywall_version_default" }, hasAdvancedRules: false, expected: "project_default_paywall" },
    { name: "no_paywall is never projected", defaultOutcome: { type: "no_paywall" }, hasAdvancedRules: false, expected: "withhold_v1_candidate" },
    { name: "advanced Rule is never projected as unconditional", defaultOutcome: { type: "paywall", paywallVersionId: "paywall_version_default" }, hasAdvancedRules: true, expected: "project_default_paywall" }
  ]
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
  const referencesPaywalls = [invalidDecision.ruleSet.defaultOutcome, ...invalidDecision.ruleSet.rules.map((rule) => rule.outcome), ...invalidDecision.ruleSet.fallbacks.map((fallback) => fallback.outcome), ...invalidDecision.ruleSet.qaOverrides.map((override) => override.outcome)].some((outcome) => outcome.type === "paywall");
  const invalid = envelope({ id: `release_invalid_${name.replaceAll("-", "_")}`, number: 99, decisions: [invalidDecision], versions: referencesPaywalls ? paywalls : [], products: referencesPaywalls ? productReferences : [], entitlements: invalidDecision.ruleSet.rules.some((rule) => JSON.stringify(rule.conditions).includes("entitlement_state")) ? [{ id: "entitlement_pro", key: "pro" }] : [] });
  write(`fixtures/configuration-delivery/v2/invalid/${name}.json`, invalid);
}

for (const [name, featureMutation] of [
  ["release-underdeclared-compatibility", (features) => features.filter((feature) => feature !== "source.device.platform")],
  ["release-overdeclared-compatibility", (features) => [...features, "condition.any"].sort()],
]) {
  const invalid = structuredClone(advanced);
  invalid.release.id = `release_invalid_${name.replaceAll("-", "_")}`;
  invalid.release.compatibility.placementDecisionContracts[0].requiredFeatures = featureMutation(invalid.release.compatibility.placementDecisionContracts[0].requiredFeatures);
  invalid.release.contentDigest = releaseMaterialDigest(invalid);
  write(`fixtures/configuration-delivery/v2/invalid/${name}.json`, invalid);
}

const productionQa = envelope({ id: "release_invalid_production_qa_override", number: 99, decisions: [qaOverrideDecision()], versions: [], products: [], entitlements: [] });
write("fixtures/configuration-delivery/v2/invalid/production-qa-override.json", productionQa);

const invalidEnvironmentMode = structuredClone(advanced);
invalidEnvironmentMode.release.id = "release_invalid_environment_mode";
invalidEnvironmentMode.release.environment.mode = "preview";
invalidEnvironmentMode.release.contentDigest = releaseMaterialDigest(invalidEnvironmentMode);
write("fixtures/configuration-delivery/v2/invalid/invalid-environment-mode.json", invalidEnvironmentMode);
