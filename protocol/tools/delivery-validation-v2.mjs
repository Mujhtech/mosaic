import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { releaseMaterialDigest } from "./delivery-v1-common.mjs";
import { loadDeliveryV1Artifacts, validateDeliveryV1Release } from "./delivery-validation-v1.mjs";
import { decisionV1Root, loadDecisionV1Artifacts, validateDecisionV1 } from "./placement-decision-validation-v1.mjs";
import { loadProtocolV03Artifacts } from "./validation-v0.3.mjs";

export const deliveryV2Paths = Object.freeze({
  releaseSchema: resolve(decisionV1Root, "schema/configuration-delivery/v2/release.schema.json"),
  capabilityRequestSchema: resolve(decisionV1Root, "schema/configuration-delivery/v2/capability-request.schema.json"),
  manifestSchema: resolve(decisionV1Root, "schema/configuration-delivery/v2/compatibility-manifest.schema.json"),
  manifest: resolve(decisionV1Root, "compatibility/configuration-delivery/v2.json"),
  validFixtures: ["advanced-release.json", "no-paywall-release.json", "staging-qa-override-release.json"].map((name) => resolve(decisionV1Root, "fixtures/configuration-delivery/v2", name)),
  capabilityRequest: resolve(decisionV1Root, "fixtures/configuration-delivery/v2/capability-request.json"),
  legacyProjection: resolve(decisionV1Root, "fixtures/configuration-delivery/v2/legacy-projection.json"),
  invalidFixtures: ["unsupported-operator.json", "invalid-condition-type.json", "duplicate-priority.json", "fallback-cycle.json", "incompatible-source-operator.json", "missing-unavailable-fallback.json", "underdeclared-features.json", "overdeclared-features.json", "release-underdeclared-compatibility.json", "release-overdeclared-compatibility.json", "qa-override-over-24h.json", "production-qa-override.json", "invalid-environment-mode.json"].map((name) => resolve(decisionV1Root, "fixtures/configuration-delivery/v2/invalid", name)),
});

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
export function loadDeliveryV2Artifacts() {
  return { releaseSchema: read(deliveryV2Paths.releaseSchema), capabilityRequestSchema: read(deliveryV2Paths.capabilityRequestSchema), manifestSchema: read(deliveryV2Paths.manifestSchema), manifest: read(deliveryV2Paths.manifest), validReleases: deliveryV2Paths.validFixtures.map(read), capabilityRequest: read(deliveryV2Paths.capabilityRequest), legacyProjection: read(deliveryV2Paths.legacyProjection), invalidReleases: deliveryV2Paths.invalidFixtures.map(read) };
}

function validators(artifacts) {
  const protocol = loadProtocolV03Artifacts(); const decision = loadDecisionV1Artifacts(); const deliveryV1 = loadDeliveryV1Artifacts();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schema of [protocol.paywallSchema, decision.schema, deliveryV1.releaseSchema, deliveryV1.capabilityRequestSchema]) ajv.addSchema(schema);
  return { release: ajv.compile(artifacts.releaseSchema), capabilityRequest: ajv.compile(artifacts.capabilityRequestSchema), manifest: ajv.compile(artifacts.manifestSchema) };
}
const schemaErrors = (label, errors = []) => errors.map((error) => `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
const duplicates = (entries, field, label, errors) => { const seen = new Set(); for (const entry of entries) { if (seen.has(entry[field])) errors.push(`${label} contains duplicate ${field} ${entry[field]}`); seen.add(entry[field]); } };
const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));

function collectOutcome(outcome, paywalls) { if (outcome.type === "paywall") paywalls.add(outcome.paywallVersionId); }
function collectDecisionReferences(decision) {
  const paywalls = new Set(); const products = new Set(); const entitlements = new Set();
  const outcomes = [decision.ruleSet.defaultOutcome, ...decision.ruleSet.rules.map((rule) => rule.outcome), ...decision.ruleSet.fallbacks.map((fallback) => fallback.outcome), ...decision.ruleSet.qaOverrides.map((override) => override.outcome)];
  for (const outcome of outcomes) collectOutcome(outcome, paywalls);
  for (const rule of decision.ruleSet.rules) {
    const visit = (node) => { if (node.type === "condition") { if (["product_availability", "product_readiness"].includes(node.source.kind)) products.add(node.source.productId); if (node.source.kind === "entitlement_state") entitlements.add(node.source.key); } else { if (node.child) visit(node.child); for (const child of node.children ?? []) visit(child); } };
    visit(rule.conditions);
  }
  return { paywalls, products, entitlements };
}

function validateSemantics(envelope) {
  const errors = []; const release = envelope.release;
  if (release.contentDigest !== releaseMaterialDigest(envelope)) errors.push("release contentDigest does not match canonical release material");
  for (const [entries, field, label] of [[release.paywallVersions, "id", "Paywall Versions"], [release.productReferences, "id", "Product references"], [release.entitlementReferences, "id", "Entitlement references"], [release.entitlementReferences, "key", "Entitlement references"], [release.assetReferences, "id", "Asset references"]]) duplicates(entries, field, label, errors);
  const placementKeys = new Set(); const placementIds = new Set(); const ruleSetIds = new Set(); const paywalls = new Set(); const products = new Set(); const entitlements = new Set();
  const features = new Set(); const algorithms = new Set();
  for (const decision of release.placementDecisions) {
    const ruleSet = decision.ruleSet;
    for (const [set, value, label] of [[placementKeys, ruleSet.placementKey, "Placement key"], [placementIds, ruleSet.placementId, "Placement ID"], [ruleSetIds, ruleSet.id, "Rule Set ID"]]) { if (set.has(value)) errors.push(`${label} ${value} is duplicated`); set.add(value); }
    if (ruleSet.projectId !== release.projectId) errors.push(`Rule Set ${ruleSet.id} Project does not match release`);
    if (ruleSet.environmentId !== release.environment.id || ruleSet.environmentKey !== release.environment.key) errors.push(`Rule Set ${ruleSet.id} Environment does not match release`);
    errors.push(...validateDecisionV1(decision).map((error) => `Rule Set ${ruleSet.id}: ${error}`));
    const refs = collectDecisionReferences(decision); for (const value of refs.paywalls) paywalls.add(value); for (const value of refs.products) products.add(value); for (const value of refs.entitlements) entitlements.add(value);
    for (const value of ruleSet.compatibility.requiredFeatures) features.add(value); for (const value of ruleSet.compatibility.bucketingAlgorithms) algorithms.add(value);
    if (ruleSet.qaOverrides.length > 0 && !["development", "staging"].includes(release.environment.mode)) errors.push(`Rule Set ${ruleSet.id} contains a QA override outside development or staging`);
  }
  const actualPaywalls = new Set(release.paywallVersions.map((version) => version.id));
  if (!sameSet(paywalls, actualPaywalls)) errors.push("Paywall Versions must exactly equal decision Paywall references");
  const paywallProducts = new Set(release.paywallVersions.flatMap((version) => version.productReferenceIds)); for (const value of paywallProducts) products.add(value);
  if (!sameSet(products, new Set(release.productReferences.map((product) => product.id)))) errors.push("Product references must exactly equal Paywall and decision Product references");
  if (!sameSet(entitlements, new Set(release.entitlementReferences.map((entry) => entry.key)))) errors.push("Entitlement references must exactly equal decision Entitlement keys");
  const decisionCompatibility = release.compatibility.placementDecisionContracts[0];
  if (!sameSet(features, new Set(decisionCompatibility.requiredFeatures)) || !sameSet(algorithms, new Set(decisionCompatibility.bucketingAlgorithms))) errors.push("release decision compatibility must exactly equal embedded Rule Set requirements");
  if (release.paywallVersions.length > 0) {
    const v1 = { configurationDeliveryVersion: "1", release: { id: release.id, number: release.number, environment: { id: release.environment.id, key: release.environment.key }, publishedAt: release.publishedAt, contentDigest: `sha256:${"0".repeat(64)}`, compatibility: { paywallProtocols: release.compatibility.paywallProtocols, acceptance: "atomic" }, placements: release.paywallVersions.map((version, index) => ({ key: `projection_${index}`, paywallVersionId: version.id })), paywallVersions: release.paywallVersions, productReferences: release.productReferences.filter((product) => paywallProducts.has(product.id)).map(({ readiness: _readiness, ...product }) => product), assetReferences: release.assetReferences } };
    v1.release.contentDigest = releaseMaterialDigest(v1);
    errors.push(...validateDeliveryV1Release(v1).map((error) => `embedded Paywall material: ${error}`));
  } else if (release.assetReferences.length > 0) errors.push("zero-Paywall release cannot contain Asset references");
  const expectedCapabilities = new Set(release.paywallVersions.flatMap((version) => version.document.compatibility.requiredCapabilities.map((capability) => `${capability.name}@${capability.version}`)));
  const actualCapabilities = new Set(release.compatibility.paywallProtocols[0].requiredCapabilities.map((capability) => `${capability.name}@${capability.version}`));
  if (!sameSet(expectedCapabilities, actualCapabilities)) errors.push("release Paywall compatibility must exactly equal embedded documents");
  return errors;
}

export function validateDeliveryV2Release(envelope, artifacts = loadDeliveryV2Artifacts()) { const validate = validators(artifacts).release; if (!validate(envelope)) return schemaErrors("release", validate.errors); return validateSemantics(envelope); }
export function validateDeliveryV2CapabilityRequest(request, artifacts = loadDeliveryV2Artifacts()) { const validate = validators(artifacts).capabilityRequest; if (!validate(request)) return schemaErrors("capability request", validate.errors); const errors = []; duplicates(request.supportedPaywallProtocols, "version", "supported Paywall protocols", errors); return errors; }
export function validateDeliveryV2Artifacts(artifacts = loadDeliveryV2Artifacts()) {
  const errors = []; const compiled = validators(artifacts);
  if (!compiled.manifest(artifacts.manifest)) errors.push(...schemaErrors("compatibility manifest", compiled.manifest.errors));
  for (const [index, release] of artifacts.validReleases.entries()) errors.push(...validateDeliveryV2Release(release, artifacts).map((error) => `valid fixture ${index + 1}: ${error}`));
  errors.push(...validateDeliveryV2CapabilityRequest(artifacts.capabilityRequest, artifacts));
  for (const [index, release] of artifacts.invalidReleases.entries()) if (validateDeliveryV2Release(release, artifacts).length === 0) errors.push(`invalid fixture ${index + 1} was accepted`);
  for (const testCase of artifacts.legacyProjection.cases) {
    const actual = testCase.defaultOutcome.type === "paywall" ? "project_default_paywall" : "withhold_v1_candidate";
    if (actual !== testCase.expected) errors.push(`legacy projection case ${testCase.name} failed`);
  }
  return errors;
}
export function validateDeliveryV2JsonFormatting() { const paths = [deliveryV2Paths.releaseSchema, deliveryV2Paths.capabilityRequestSchema, deliveryV2Paths.manifestSchema, deliveryV2Paths.manifest, ...deliveryV2Paths.validFixtures, deliveryV2Paths.capabilityRequest, deliveryV2Paths.legacyProjection, ...deliveryV2Paths.invalidFixtures]; return paths.flatMap((path) => { const source = readFileSync(path, "utf8"); return source === `${JSON.stringify(JSON.parse(source), null, 2)}\n` ? [] : [`${relative(decisionV1Root, path)} is not canonical JSON`]; }); }
export function decideDeliveryV2Candidate({ candidate, lastAcceptedReleaseAvailable, bundledReleaseAvailable }) { const errors = validateDeliveryV2Release(candidate); if (errors.length === 0) return { action: "acceptRelease", errors: [] }; if (lastAcceptedReleaseAvailable) return { action: "keepLastAcceptedRelease", errors }; if (bundledReleaseAvailable) return { action: "loadBundledRelease", errors }; return { action: "configurationUnavailable", errors }; }
