import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const decisionV1Root = resolve(toolsDirectory, "..");
export const decisionV1Paths = Object.freeze({
  schema: resolve(decisionV1Root, "schema/placement-decision/v1/decision.schema.json"),
  manifestSchema: resolve(decisionV1Root, "schema/placement-decision/v1/compatibility-manifest.schema.json"),
  manifest: resolve(decisionV1Root, "compatibility/placement-decision/v1.json"),
  evaluatorFixture: resolve(decisionV1Root, "fixtures/placement-decision/v1/evaluator-conformance.json"),
  rolloutFixture: resolve(decisionV1Root, "fixtures/placement-decision/v1/rollout-vectors.json"),
  invalidFixtures: ["unsupported-operator.json", "invalid-condition-type.json", "duplicate-priority.json", "fallback-cycle.json", "incompatible-source-operator.json", "missing-unavailable-fallback.json", "underdeclared-features.json", "overdeclared-features.json", "qa-override-over-24h.json"].map((name) => resolve(decisionV1Root, "fixtures/placement-decision/v1/invalid", name)),
});

export const readDecisionV1Json = (path) => JSON.parse(readFileSync(path, "utf8"));

export function loadDecisionV1Artifacts() {
  return {
    schema: readDecisionV1Json(decisionV1Paths.schema),
    manifestSchema: readDecisionV1Json(decisionV1Paths.manifestSchema),
    manifest: readDecisionV1Json(decisionV1Paths.manifest),
    evaluatorFixture: readDecisionV1Json(decisionV1Paths.evaluatorFixture),
    rolloutFixture: readDecisionV1Json(decisionV1Paths.rolloutFixture),
    invalidFixtures: decisionV1Paths.invalidFixtures.map(readDecisionV1Json),
  };
}

const schemaErrors = (label, errors = []) => errors.map((error) => `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
const duplicateValues = (items, field) => items.filter((item, index) => items.findIndex((candidate) => candidate[field] === item[field]) !== index).map((item) => item[field]);

function walk(node, visit, depth = 1) {
  visit(node, depth);
  if (node.type === "not") walk(node.child, visit, depth + 1);
  for (const child of node.children ?? []) walk(child, visit, depth + 1);
}

function referencedFeatures(ruleSet) {
  const features = new Set();
  const addOutcome = (outcome) => features.add(`outcome.${outcome.type}`);
  addOutcome(ruleSet.defaultOutcome);
  for (const fallback of ruleSet.fallbacks) addOutcome(fallback.outcome);
  for (const override of ruleSet.qaOverrides) { features.add("override.qa"); addOutcome(override.outcome); }
  for (const rule of ruleSet.rules) {
    addOutcome(rule.outcome);
    walk(rule.conditions, (node) => {
      if (node.type === "condition") {
        features.add(`source.${node.source.kind}`);
        features.add(`operator.${node.operator}`);
      } else features.add(`condition.${node.type}`);
    });
  }
  return [...features].sort();
}

function canonicalCondition(node) {
  if (node.type === "condition") return JSON.stringify(node);
  if (node.type === "not") return JSON.stringify({ type: node.type, child: JSON.parse(canonicalCondition(node.child)) });
  return JSON.stringify({ type: node.type, children: node.children.map((child) => JSON.parse(canonicalCondition(child))) });
}

function decisionWarnings(document) {
  const warnings = [];
  const append = (warning) => { if (warnings.length < 64) warnings.push(warning); };
  for (const rule of document.ruleSet.rules) {
    const leaves = new Map();
    walk(rule.conditions, (node) => {
      if (node.type !== "condition") return;
      const key = canonicalCondition(node);
      leaves.set(key, (leaves.get(key) ?? 0) + 1);
    });
    if ([...leaves.values()].some((count) => count > 1)) append(`Rule ${rule.id} contains a duplicate leaf condition`);
  }
  const enabled = [...document.ruleSet.rules].filter((rule) => rule.enabled).sort((left, right) => left.priority - right.priority);
  const unconditionalByCondition = new Map();
  for (const rule of enabled) {
    const condition = canonicalCondition(rule.conditions);
    const earlier = unconditionalByCondition.get(condition);
    if (earlier) append(`Rule ${rule.id} is obviously shadowed by earlier Rule ${earlier}`);
    if (!rule.rollout && !unconditionalByCondition.has(condition)) unconditionalByCondition.set(condition, rule.id);
  }
  return warnings;
}

function sourceContract(source, definitions) {
  switch (source.kind) {
    case "device.platform": return { type: "string", values: ["ios", "android"], operators: ["equals", "not_equals", "in", "not_in"] };
    case "device.os_version":
    case "application.version": return { type: "semantic_version", operators: ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"] };
    case "application.locale": return { type: "string", operators: ["equals", "not_equals", "in", "not_in", "exists", "does_not_exist", "locale_matches"] };
    case "context.country": return { type: "string", pattern: /^[A-Z]{2}$/, operators: ["equals", "not_equals", "in", "not_in", "exists", "does_not_exist"] };
    case "environment.id":
    case "environment.key": return { type: "string", operators: ["equals", "not_equals", "in", "not_in"] };
    case "identity.user_present": return { type: "boolean", operators: ["equals", "not_equals"] };
    case "user_attribute": {
      const definition = definitions.get(source.key);
      return definition ? { type: definition.type, operators: definition.allowedOperators } : null;
    }
    case "entitlement_state": return { type: "string", values: ["active", "inactive", "unknown", "provider_unavailable", "failed"], operators: ["equals", "not_equals", "in", "not_in"] };
    case "product_availability": return { type: "string", values: ["available", "unavailable", "unknown", "provider_unavailable", "failed"], operators: ["equals", "not_equals", "in", "not_in"] };
    case "product_readiness": return { type: "string", values: ["ready", "not_ready"], operators: ["equals", "not_equals"] };
    case "provider_capability": return { type: "string", values: ["available", "unavailable", "unknown"], operators: ["equals", "not_equals"] };
    default: return null;
  }
}

function validateOperand(errors, leaf, contract, label) {
  if (!contract) { errors.push(`${label} references an undefined user attribute`); return; }
  if (!contract.operators.includes(leaf.operator)) errors.push(`${label} operator ${leaf.operator} is incompatible with ${leaf.source.kind}`);
  if (!leaf.operand) return;
  const expectedType = ["in", "not_in"].includes(leaf.operator) ? "string_list" : contract.type;
  if (leaf.operand.type !== expectedType) errors.push(`${label} operand type ${leaf.operand.type} must be ${expectedType}`);
  const values = Array.isArray(leaf.operand.value) ? leaf.operand.value : [leaf.operand.value];
  if (contract.values && values.some((value) => !contract.values.includes(value))) errors.push(`${label} contains a value outside the closed ${leaf.source.kind} state set`);
  if (contract.pattern && values.some((value) => typeof value !== "string" || !contract.pattern.test(value))) errors.push(`${label} contains a non-canonical ${leaf.source.kind} value`);
  if (leaf.operand.type === "semantic_version" && parseSemver(leaf.operand.value) === null) errors.push(`${label} contains an invalid mosaic_semver_v1 value`);
  if (leaf.operand.type === "timestamp" && (!Number.isFinite(Date.parse(leaf.operand.value)) || new Date(leaf.operand.value).toISOString() !== leaf.operand.value)) errors.push(`${label} contains an invalid UTC millisecond timestamp`);
  if (leaf.operator === "locale_matches" && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(leaf.operand.value)) errors.push(`${label} contains an invalid bounded BCP 47 locale range`);
}

function outcomeTargets(outcome, targets) {
  if (outcome.type === "fallback") targets.push(outcome.key);
  if (outcome.type === "paywall" && outcome.unavailableFallbackKey) targets.push(outcome.unavailableFallbackKey);
}

function validateDecisionSemantics(document) {
  const errors = [];
  const ruleSet = document.ruleSet;
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > 262144) errors.push("decision document exceeds 256 KiB");
  for (const field of [[ruleSet.rules, "id"], [ruleSet.rules, "priority"], [ruleSet.fallbacks, "key"], [ruleSet.attributeDefinitions, "key"], [ruleSet.qaOverrides, "id"], [ruleSet.qaOverrides, "selectorDigest"]]) {
    for (const value of new Set(duplicateValues(...field))) errors.push(`rule set contains duplicate ${field[1]} ${value}`);
  }
  const definitions = new Map(ruleSet.attributeDefinitions.map((definition) => [definition.key, definition]));
  const attributeOperators = {
    string: ["equals", "not_equals", "in", "not_in", "exists", "does_not_exist"],
    boolean: ["equals", "not_equals", "exists", "does_not_exist"],
    number: ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"],
    timestamp: ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"],
    semantic_version: ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"],
    string_list: ["contains_any", "contains_all", "exists", "does_not_exist"],
  };
  for (const definition of ruleSet.attributeDefinitions) if (definition.allowedOperators.some((operator) => !attributeOperators[definition.type].includes(operator))) errors.push(`attribute ${definition.key} declares an operator incompatible with ${definition.type}`);
  for (const rule of ruleSet.rules) {
    let leaves = 0;
    let maxDepth = 0;
    walk(rule.conditions, (node, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      if (node.type === "condition") { leaves += 1; validateOperand(errors, node, sourceContract(node.source, definitions), `Rule ${rule.id}`); }
    });
    if (maxDepth > 5) errors.push(`Rule ${rule.id} exceeds maximum condition depth 5`);
    if (leaves > 64) errors.push(`Rule ${rule.id} exceeds maximum 64 leaves`);
  }
  const fallbackByKey = new Map(ruleSet.fallbacks.map((fallback) => [fallback.key, fallback]));
  const outcomes = [ruleSet.defaultOutcome, ...ruleSet.rules.map((rule) => rule.outcome), ...ruleSet.qaOverrides.map((override) => override.outcome), ...ruleSet.fallbacks.map((fallback) => fallback.outcome)];
  for (const outcome of outcomes) {
    const targets = []; outcomeTargets(outcome, targets);
    for (const target of targets) if (!fallbackByKey.has(target)) errors.push(`outcome references unknown fallback ${target}`);
  }
  for (const start of fallbackByKey.keys()) {
    const seen = new Set(); let key = start; let depth = 0;
    while (key) {
      if (seen.has(key)) { errors.push(`fallback cycle includes ${key}`); break; }
      seen.add(key); depth += 1;
      if (depth > 8) { errors.push(`fallback ${start} exceeds maximum depth 8`); break; }
      const outcome = fallbackByKey.get(key)?.outcome;
      key = outcome?.type === "fallback" ? outcome.key : outcome?.unavailableFallbackKey;
    }
  }
  for (const override of ruleSet.qaOverrides) {
    const startsAt = Date.parse(override.startsAt);
    const expiresAt = Date.parse(override.expiresAt);
    if (!Number.isFinite(startsAt) || new Date(startsAt).toISOString() !== override.startsAt) errors.push(`QA override ${override.id} has an invalid startsAt`);
    if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== override.expiresAt) errors.push(`QA override ${override.id} has an invalid expiresAt`);
    const duration = expiresAt - startsAt;
    if (!(duration > 0 && duration <= 86400000)) errors.push(`QA override ${override.id} must expire within 24 hours`);
  }
  const expectedFeatures = referencedFeatures(ruleSet);
  if (JSON.stringify([...ruleSet.compatibility.requiredFeatures].sort()) !== JSON.stringify(expectedFeatures)) errors.push("requiredFeatures must exactly equal semantics used by the Rule Set");
  const expectsRollout = ruleSet.rules.some((rule) => rule.rollout);
  const expectedAlgorithms = expectsRollout ? ["sha256_length_prefixed_v1"] : [];
  if (JSON.stringify(ruleSet.compatibility.bucketingAlgorithms) !== JSON.stringify(expectedAlgorithms)) errors.push("bucketingAlgorithms must exactly equal algorithms used by Rules");
  return errors;
}

function compiledValidators(artifacts) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return { decision: ajv.compile(artifacts.schema), manifest: ajv.compile(artifacts.manifestSchema) };
}

export function validateDecisionV1(document, artifacts = loadDecisionV1Artifacts()) {
  return validateDecisionV1Detailed(document, artifacts).errors;
}

export function validateDecisionV1Detailed(document, artifacts = loadDecisionV1Artifacts()) {
  const validate = compiledValidators(artifacts).decision;
  if (!validate(document)) return { errors: schemaErrors("decision", validate.errors), warnings: [] };
  return { errors: validateDecisionSemantics(document), warnings: decisionWarnings(document) };
}

export function rolloutV1(fields) {
  const ordered = [fields.projectId, fields.environmentId, fields.placementId, fields.ruleId, fields.assignmentKeyType, fields.assignmentKeyValue];
  const canonicalUtf8 = `mosaic-placement-rollout\n1\n${ordered.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}\n`).join("")}`;
  const digest = createHash("sha256").update(canonicalUtf8, "utf8").digest();
  return { canonicalUtf8, sha256Hex: digest.toString("hex"), bucket: Number(digest.readBigUInt64BE(0) % 10000n) };
}

function parseSemver(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return { core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], prerelease };
}

function compareSemver(left, right) {
  const a = parseSemver(left); const b = parseSemver(right); if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined || b.prerelease[index] === undefined) return a.prerelease[index] === undefined ? -1 : 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const an = /^\d+$/.test(a.prerelease[index]); const bn = /^\d+$/.test(b.prerelease[index]);
    if (an && bn) return Number(a.prerelease[index]) < Number(b.prerelease[index]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1;
  }
  return 0;
}

function normalizeLocale(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().replaceAll("_", "-").split("-");
  if (parts.length === 0 || parts.length > 8 || !/^[A-Za-z]{2,8}$/.test(parts[0]) || parts.slice(1).some((part) => !/^[A-Za-z0-9]{1,8}$/.test(part))) return null;
  return parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[A-Za-z]{4}$/.test(part)) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    if (/^(?:[A-Za-z]{2}|[0-9]{3})$/.test(part)) return part.toUpperCase();
    return part.toLowerCase();
  }).join("-");
}

const MISSING = Symbol("missing");
function sourceValue(source, context) {
  const values = {
    "device.platform": context.platform,
    "device.os_version": context.osVersion,
    "application.version": context.applicationVersion,
    "application.locale": context.applicationLocale,
    "context.country": context.country,
    "environment.id": context.environmentId,
    "environment.key": context.environmentKey,
    "identity.user_present": context.userPresent,
  };
  if (Object.hasOwn(values, source.kind)) {
    const value = values[source.kind];
    if (source.kind === "context.country" && typeof value === "string") return /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : MISSING;
    if (source.kind === "application.locale") return value == null ? MISSING : normalizeLocale(value) ?? value;
    return value ?? MISSING;
  }
  if (source.kind === "user_attribute") return context.attributes?.[source.key]?.value ?? MISSING;
  if (source.kind === "entitlement_state") return context.entitlements?.[source.key] ?? MISSING;
  if (source.kind === "product_availability") return context.products?.[source.productId] ?? MISSING;
  if (source.kind === "product_readiness") return context.productReadiness?.[source.productId] ?? MISSING;
  if (source.kind === "provider_capability") return context.providerCapabilities?.[source.capability] ?? MISSING;
  return MISSING;
}

function evaluateLeaf(leaf, context) {
  const value = sourceValue(leaf.source, context);
  if (leaf.operator === "exists") return value === MISSING ? "false" : "true";
  if (leaf.operator === "does_not_exist") return value === MISSING ? "true" : "false";
  if (value === MISSING) return "unknown";
  const operand = leaf.operand.value;
  const closedStates = {
    "device.platform": ["ios", "android"],
    entitlement_state: ["active", "inactive", "unknown", "provider_unavailable", "failed"],
    product_availability: ["available", "unavailable", "unknown", "provider_unavailable", "failed"],
    product_readiness: ["ready", "not_ready"],
    provider_capability: ["available", "unavailable", "unknown"],
  };
  if (closedStates[leaf.source.kind] && !closedStates[leaf.source.kind].includes(value)) return "unknown";
  if (["device.os_version", "application.version"].includes(leaf.source.kind) && parseSemver(value) === null) return "unknown";
  if (leaf.source.kind === "application.locale" && normalizeLocale(value) === null) return "unknown";
  if (leaf.operand.type === "semantic_version" && ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"].includes(leaf.operator)) {
    const comparison = compareSemver(value, operand);
    if (comparison === null) return "unknown";
    const matches = ({ equals: comparison === 0, not_equals: comparison !== 0, greater_than: comparison > 0, greater_than_or_equal: comparison >= 0, less_than: comparison < 0, less_than_or_equal: comparison <= 0 })[leaf.operator];
    return matches ? "true" : "false";
  }
  if (leaf.operator === "locale_matches") {
    if (typeof value !== "string" || typeof operand !== "string") return "unknown";
    const candidate = normalizeLocale(value); const range = normalizeLocale(operand);
    if (candidate === null || range === null) return "unknown";
    return candidate === range || candidate.startsWith(`${range}-`) ? "true" : "false";
  }
  if (["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"].includes(leaf.operator)) {
    const comparison = leaf.operand.type === "timestamp" && typeof value === "string" ? Math.sign(Date.parse(value) - Date.parse(operand)) : typeof value === "number" && typeof operand === "number" ? Math.sign(value - operand) : null;
    if (comparison === null) return "unknown";
    return ({ greater_than: comparison > 0, greater_than_or_equal: comparison >= 0, less_than: comparison < 0, less_than_or_equal: comparison <= 0 })[leaf.operator] ? "true" : "false";
  }
  if (leaf.operator === "contains_any" || leaf.operator === "contains_all") {
    if (!Array.isArray(value) || !Array.isArray(operand)) return "unknown";
    const matches = leaf.operator === "contains_any" ? operand.some((item) => value.includes(item)) : operand.every((item) => value.includes(item));
    return matches ? "true" : "false";
  }
  if (leaf.operator === "in" || leaf.operator === "not_in") {
    const candidates = leaf.source.kind === "application.locale" ? operand.map(normalizeLocale) : operand;
    if (candidates.some((candidate) => candidate === null)) return "unknown";
    const included = candidates.includes(value); return (leaf.operator === "in" ? included : !included) ? "true" : "false";
  }
  const comparableOperand = leaf.source.kind === "application.locale" ? normalizeLocale(operand) : operand;
  if (comparableOperand === null) return "unknown";
  const equal = value === comparableOperand;
  return (leaf.operator === "equals" ? equal : !equal) ? "true" : "false";
}

function evaluateNode(node, context) {
  if (node.type === "condition") return evaluateLeaf(node, context);
  if (node.type === "not") { const value = evaluateNode(node.child, context); return value === "unknown" ? value : value === "true" ? "false" : "true"; }
  const values = node.children.map((child) => evaluateNode(child, context));
  if (node.type === "all") return values.includes("false") ? "false" : values.includes("unknown") ? "unknown" : "true";
  return values.includes("true") ? "true" : values.includes("unknown") ? "unknown" : "false";
}

function resolveOutcome(outcome, fallbackByKey, path = []) {
  if (outcome.type !== "fallback") return { ...(path.length === 0 ? {} : { fallbackPath: path }), outcome };
  return resolveOutcome(fallbackByKey.get(outcome.key).outcome, fallbackByKey, [...path, outcome.key]);
}

export function evaluateDecisionV1(document, context, assignment) {
  const ruleSet = document.ruleSet;
  const fallbackByKey = new Map(ruleSet.fallbacks.map((fallback) => [fallback.key, fallback]));
  const now = Date.parse(context.now ?? new Date(0).toISOString());
  const override = ruleSet.qaOverrides.find((candidate) => candidate.selectorDigest === context.qaOverrideSelectorDigest && now >= Date.parse(candidate.startsAt) && now < Date.parse(candidate.expiresAt));
  if (override) return { matchedRuleId: null, overrideId: override.id, ...resolveOutcome(override.outcome, fallbackByKey) };
  if (!ruleSet.enabled) return { matchedRuleId: null, ...resolveOutcome(ruleSet.defaultOutcome, fallbackByKey) };
  for (const rule of [...ruleSet.rules].sort((left, right) => left.priority - right.priority)) {
    if (!rule.enabled || evaluateNode(rule.conditions, context) !== "true") continue;
    let rolloutBucket;
    if (rule.rollout) {
      if (!assignment?.value) continue;
      rolloutBucket = rolloutV1({ projectId: ruleSet.projectId, environmentId: ruleSet.environmentId, placementId: ruleSet.placementId, ruleId: rule.id, assignmentKeyType: assignment.type, assignmentKeyValue: assignment.value }).bucket;
      if (rolloutBucket >= rule.rollout.thresholdBasisPoints) continue;
    }
    return { matchedRuleId: rule.id, ...(rolloutBucket === undefined ? {} : { rolloutBucket }), ...resolveOutcome(rule.outcome, fallbackByKey) };
  }
  return { matchedRuleId: null, ...resolveOutcome(ruleSet.defaultOutcome, fallbackByKey) };
}

export function validateDecisionV1Artifacts(artifacts = loadDecisionV1Artifacts()) {
  const errors = [];
  const validators = compiledValidators(artifacts);
  if (!validators.manifest(artifacts.manifest)) errors.push(...schemaErrors("compatibility manifest", validators.manifest.errors));
  errors.push(...validateDecisionV1(artifacts.evaluatorFixture.decision, artifacts));
  for (const invalid of artifacts.invalidFixtures) if (validateDecisionV1(invalid, artifacts).length === 0) errors.push(`invalid fixture ${invalid.ruleSet.id} was accepted`);
  for (const vector of artifacts.rolloutFixture.vectors) {
    const actual = rolloutV1(vector);
    for (const field of ["canonicalUtf8", "sha256Hex", "bucket"]) if (actual[field] !== vector[field]) errors.push(`rollout vector ${vector.ruleId}/${vector.assignmentKeyType} has incorrect ${field}`);
    for (const threshold of vector.thresholdCases) if ((actual.bucket < threshold.thresholdBasisPoints) !== threshold.matches) errors.push(`rollout vector ${vector.ruleId} has incorrect threshold result`);
  }
  for (const testCase of artifacts.evaluatorFixture.cases) {
    const actual = evaluateDecisionV1(artifacts.evaluatorFixture.decision, testCase.context, testCase.assignment);
    const canonical = (value) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry);
    if (canonical(actual) !== canonical(testCase.expected)) errors.push(`evaluator case ${testCase.name} expected ${JSON.stringify(testCase.expected)} but received ${JSON.stringify(actual)}`);
  }
  return errors;
}

export function validateDecisionV1JsonFormatting() {
  const paths = [decisionV1Paths.schema, decisionV1Paths.manifestSchema, decisionV1Paths.manifest, decisionV1Paths.evaluatorFixture, decisionV1Paths.rolloutFixture, ...decisionV1Paths.invalidFixtures];
  return paths.flatMap((path) => { const source = readFileSync(path, "utf8"); return source === `${JSON.stringify(JSON.parse(source), null, 2)}\n` ? [] : [`${relative(decisionV1Root, path)} is not canonical JSON`]; });
}
