/**
 * Projects the Analytics Event correlation/attribution allow-lists from the
 * semantic validator tables into the canonical v1 and v2 event schemas.
 *
 * Mosaic's release-blocker policy treats "canonical schema, semantic validator,
 * and API runtime path disagreeing about validity" as a blocker. Deriving the
 * schema allow-lists from the same tables the semantic validator uses makes
 * that class of divergence structurally impossible rather than merely tested:
 * editing a table and forgetting to edit the schema produces generation drift,
 * which CI fails on.
 *
 * Generated artifacts inside each event schema:
 *   - `$defs/{correlation,attribution}Scope*` allow-list subschemas;
 *   - a `$ref` to the matching scope from every per-event branch;
 *   - `dependentRequired` tuple-atomicity rules on `$defs/attribution` and
 *     `$defs/placementSelectionPayload`.
 *
 * Everything else in the schemas is hand-authored and preserved verbatim. The
 * generator strips its own previous output before re-emitting, so it is
 * idempotent.
 *
 * Run via `npm run generate`. Reconciled at validation time by
 * `validateAnalyticsMinimizationProjection`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyticsEventV1AttributionAllowLists,
  analyticsEventV1CorrelationAllowLists,
} from "./analytics-event-validation-v1.mjs";
import {
  analyticsEventV2AttributionAllowLists,
  analyticsEventV2CorrelationAllowLists,
} from "./analytics-event-validation-v2.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Stable, human-meaningful names for every distinct allow-list shape. Keyed by
 * the sorted field list so a newly introduced shape fails loudly and forces a
 * deliberate naming decision rather than silently producing an opaque def name.
 */
const SCOPE_NAMES = new Map([
  // correlation
  [key(["placementRequestId"]), "correlationScopePlacementRequest"],
  [
    key(["placementRequestId", "paywallPresentationId"]),
    "correlationScopePaywallPresentation",
  ],
  [
    key(["placementRequestId", "paywallPresentationId", "productLoadAttemptId"]),
    "correlationScopeProductLoad",
  ],
  [
    key([
      "placementRequestId",
      "paywallPresentationId",
      "productLoadAttemptId",
      "purchaseAttemptId",
      "providerOperationId",
    ]),
    "correlationScopePurchaseAttempt",
  ],
  [
    key(["purchaseAttemptId", "providerOperationId", "providerUpdateId"]),
    "correlationScopeProviderConfirmation",
  ],
  [
    key(["restoreAttemptId", "providerOperationId"]),
    "correlationScopeRestoreAttempt",
  ],
  // attribution
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
    ]),
    "attributionScopePlacementRequest",
  ],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
    ]),
    "attributionScopeDecidedPlacement",
  ],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
      "paywallId",
      "paywallVersionId",
    ]),
    "attributionScopePaywall",
  ],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
      "paywallId",
      "paywallVersionId",
      "mosaicProductId",
      "planId",
      "providerId",
      "providerProductMappingId",
    ]),
    "attributionScopeProduct",
  ],
  [key(["configurationReleaseId"]), "attributionScopeConfigurationRelease"],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
      "experimentId",
      "experimentVersionId",
      "experimentVariantId",
      "experimentAllocationVersion",
    ]),
    "attributionScopeDecidedPlacementExperiment",
  ],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
      "paywallId",
      "paywallVersionId",
      "experimentId",
      "experimentVersionId",
      "experimentVariantId",
      "experimentAllocationVersion",
    ]),
    "attributionScopePaywallExperiment",
  ],
  [
    key([
      "configurationReleaseId",
      "placementId",
      "placementRuleSetId",
      "placementRuleSetVersion",
      "winningRuleId",
      "paywallId",
      "paywallVersionId",
      "mosaicProductId",
      "planId",
      "providerId",
      "providerProductMappingId",
      "experimentId",
      "experimentVersionId",
      "experimentVariantId",
      "experimentAllocationVersion",
    ]),
    "attributionScopeProductExperiment",
  ],
]);

function key(fields) {
  return JSON.stringify([...fields].sort());
}

const GENERATED_SCOPE = /^(?:correlation|attribution)Scope[A-Z]/;

function isGeneratedScopeRef(subschema) {
  return (
    subschema !== null &&
    typeof subschema === "object" &&
    Object.keys(subschema).length === 1 &&
    typeof subschema.$ref === "string" &&
    GENERATED_SCOPE.test(subschema.$ref.replace("#/$defs/", ""))
  );
}

/** The RuleSet pairing rules the semantic validators enforce on attribution. */
const RULE_SET_DEPENDENT_REQUIRED = {
  placementRuleSetId: ["placementRuleSetVersion"],
  placementRuleSetVersion: ["placementRuleSetId"],
  winningRuleId: ["placementRuleSetId", "placementRuleSetVersion"],
};

/** Experiment attribution is an all-or-nothing tuple (v2 only). */
const EXPERIMENT_TUPLE = [
  "experimentId",
  "experimentVersionId",
  "experimentVariantId",
  "experimentAllocationVersion",
];

/** Rollout attribution on a Placement selection payload is all-or-nothing. */
const ROLLOUT_TUPLE = [
  "assignmentKeyType",
  "bucketingAlgorithm",
  "rolloutBucket",
];

function tupleDependentRequired(tuple) {
  return Object.fromEntries(
    [...tuple]
      .sort()
      .map((field) => [field, tuple.filter((other) => other !== field).sort()]),
  );
}

function scopeName(fields) {
  const name = SCOPE_NAMES.get(key(fields));
  if (!name) {
    throw new Error(
      `No scope name registered for allow-list [${[...fields].sort().join(", ")}]. ` +
        "Register a deliberate name in SCOPE_NAMES before regenerating.",
    );
  }
  return name;
}

function scopeDefinition(kind, fields) {
  // `properties: {field: true}` supplies the allow-list annotation; value types
  // are validated by the shared `$defs/{correlation,attribution}` subschema
  // that `properties` on the event root applies to the same instance location.
  // `unevaluatedProperties` here only observes annotations from this schema's
  // own subschema hierarchy, so the allow-list must be complete and self
  // contained -- which is exactly the property that makes it enforceable.
  return {
    type: "object",
    description:
      `Fields this event may carry in \`${kind}\`. Any other field is ` +
      "rejected: analytics minimization forbids collecting identifiers the " +
      "event's own semantics cannot justify.",
    properties: Object.fromEntries([...fields].sort().map((f) => [f, true])),
    unevaluatedProperties: false,
  };
}

/** Finds `properties.eventName.const` anywhere inside a per-event branch def. */
function branchEventName(node) {
  if (node === null || typeof node !== "object") return undefined;
  const named = node.properties?.eventName?.const;
  if (typeof named === "string") return named;
  for (const composed of node.allOf ?? []) {
    const found = branchEventName(composed);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The subschema object inside a branch that carries `properties`. */
function branchPropertiesHolder(node) {
  if (node.properties?.eventName?.const !== undefined) return node;
  for (const composed of node.allOf ?? []) {
    if (composed.properties?.eventName?.const !== undefined) return composed;
  }
  return undefined;
}

function stripGeneratedRef(subschema) {
  if (subschema === undefined) return undefined;
  if (isGeneratedScopeRef(subschema)) return undefined;
  if (!Array.isArray(subschema.allOf)) return subschema;
  const kept = subschema.allOf.filter((item) => !isGeneratedScopeRef(item));
  if (kept.length === subschema.allOf.length) return subschema;
  const rest = Object.fromEntries(
    Object.entries(subschema).filter(([name]) => name !== "allOf"),
  );
  if (Object.keys(rest).length === 0 && kept.length === 1) return kept[0];
  if (kept.length === 0) {
    return Object.keys(rest).length === 0 ? undefined : rest;
  }
  return { ...rest, allOf: kept };
}

function withScopeRef(subschema, name) {
  const ref = { $ref: `#/$defs/${name}` };
  if (subschema === undefined) return ref;
  const onlyAllOf =
    Array.isArray(subschema.allOf) && Object.keys(subschema).length === 1;
  return { allOf: onlyAllOf ? [...subschema.allOf, ref] : [subschema, ref] };
}

function project({ schemaPath, correlationAllowLists, attributionAllowLists }) {
  const absolute = resolve(root, schemaPath);
  const schema = JSON.parse(readFileSync(absolute, "utf8"));
  const defs = schema.$defs;

  // 1. Strip prior generator output so the run is idempotent.
  for (const name of Object.keys(defs)) {
    if (GENERATED_SCOPE.test(name)) delete defs[name];
  }
  const branches = Object.entries(defs).filter(
    ([, def]) => branchEventName(def) !== undefined,
  );
  for (const [, def] of branches) {
    const holder = branchPropertiesHolder(def);
    for (const kind of ["correlation", "attribution"]) {
      const stripped = stripGeneratedRef(holder.properties[kind]);
      if (stripped === undefined) delete holder.properties[kind];
      else holder.properties[kind] = stripped;
    }
  }

  // 2. Re-emit scope defs and per-branch references.
  const covered = new Set();
  const usedScopes = new Map();
  for (const [defName, def] of branches) {
    const eventName = branchEventName(def);
    covered.add(eventName);
    const holder = branchPropertiesHolder(def);
    for (const [kind, table] of [
      ["correlation", correlationAllowLists],
      ["attribution", attributionAllowLists],
    ]) {
      const fields = table[eventName];
      if (fields === undefined) {
        throw new Error(
          `${schemaPath}: $defs/${defName} declares event ${eventName}, which has no ${kind} allow-list.`,
        );
      }
      const name = scopeName(fields);
      usedScopes.set(name, scopeDefinition(kind, fields));
      holder.properties[kind] = withScopeRef(holder.properties[kind], name);
    }
  }
  for (const eventName of Object.keys(correlationAllowLists)) {
    if (!covered.has(eventName)) {
      throw new Error(
        `${schemaPath}: allow-list table declares ${eventName}, which has no schema branch.`,
      );
    }
  }
  for (const name of [...usedScopes.keys()].sort()) {
    defs[name] = usedScopes.get(name);
  }

  // 3. Tuple-atomicity rules.
  const hasExperimentTuple = EXPERIMENT_TUPLE.every(
    (field) => defs.attribution.properties[field] !== undefined,
  );
  defs.attribution.dependentRequired = {
    ...RULE_SET_DEPENDENT_REQUIRED,
    ...(hasExperimentTuple ? tupleDependentRequired(EXPERIMENT_TUPLE) : {}),
  };
  defs.placementSelectionPayload.dependentRequired =
    tupleDependentRequired(ROLLOUT_TUPLE);

  writeFileSync(absolute, `${JSON.stringify(schema, null, 2)}\n`);
  return { schemaPath, events: covered.size, scopes: usedScopes.size };
}

export const analyticsMinimizationTargets = Object.freeze([
  Object.freeze({
    schemaPath: "schema/analytics-event/v1/event.schema.json",
    correlationAllowLists: analyticsEventV1CorrelationAllowLists,
    attributionAllowLists: analyticsEventV1AttributionAllowLists,
  }),
  Object.freeze({
    schemaPath: "schema/analytics-event/v2/event.schema.json",
    correlationAllowLists: analyticsEventV2CorrelationAllowLists,
    attributionAllowLists: analyticsEventV2AttributionAllowLists,
  }),
]);

export const analyticsMinimizationRules = Object.freeze({
  ruleSetDependentRequired: RULE_SET_DEPENDENT_REQUIRED,
  experimentTuple: EXPERIMENT_TUPLE,
  rolloutTuple: ROLLOUT_TUPLE,
  tupleDependentRequired,
  scopeName,
  scopeDefinition,
});

/**
 * Reconciles the committed schemas against the validator tables without
 * writing. `npm run generate` already fails CI on drift, but this makes the
 * divergence detectable by `npm run validate` alone and names the exact event
 * and field that disagree.
 */
export function validateAnalyticsMinimizationProjection() {
  const errors = [];
  for (const target of analyticsMinimizationTargets) {
    const schema = JSON.parse(
      readFileSync(resolve(root, target.schemaPath), "utf8"),
    );
    const defs = schema.$defs;
    for (const [defName, def] of Object.entries(defs)) {
      const eventName = branchEventName(def);
      if (eventName === undefined) continue;
      const holder = branchPropertiesHolder(def);
      for (const [kind, table] of [
        ["correlation", target.correlationAllowLists],
        ["attribution", target.attributionAllowLists],
      ]) {
        const subschema = holder.properties[kind];
        const refs = [
          subschema,
          ...(subschema?.allOf ?? []),
        ].filter((item) => isGeneratedScopeRef(item));
        if (refs.length !== 1) {
          errors.push(
            `${target.schemaPath}: $defs/${defName} (${eventName}) has ${refs.length} generated ${kind} allow-list references, expected 1`,
          );
          continue;
        }
        const scope = defs[refs[0].$ref.replace("#/$defs/", "")];
        const declared = Object.keys(scope?.properties ?? {}).sort();
        const expected = [...(table[eventName] ?? [])].sort();
        if (JSON.stringify(declared) !== JSON.stringify(expected)) {
          errors.push(
            `${target.schemaPath}: ${eventName} ${kind} allow-list is [${declared.join(", ")}] but the semantic validator allows [${expected.join(", ")}]`,
          );
        }
        if (scope?.unevaluatedProperties !== false) {
          errors.push(
            `${target.schemaPath}: ${eventName} ${kind} allow-list does not close the object with unevaluatedProperties:false`,
          );
        }
      }
    }
    const hasExperimentTuple = EXPERIMENT_TUPLE.every(
      (field) => defs.attribution.properties[field] !== undefined,
    );
    const expectedAttribution = {
      ...RULE_SET_DEPENDENT_REQUIRED,
      ...(hasExperimentTuple ? tupleDependentRequired(EXPERIMENT_TUPLE) : {}),
    };
    if (
      JSON.stringify(defs.attribution.dependentRequired) !==
      JSON.stringify(expectedAttribution)
    ) {
      errors.push(
        `${target.schemaPath}: $defs/attribution dependentRequired does not encode the Rule Set${hasExperimentTuple ? " and Experiment tuple" : ""} pairing rules`,
      );
    }
    if (
      JSON.stringify(defs.placementSelectionPayload.dependentRequired) !==
      JSON.stringify(tupleDependentRequired(ROLLOUT_TUPLE))
    ) {
      errors.push(
        `${target.schemaPath}: $defs/placementSelectionPayload dependentRequired does not encode rollout-tuple atomicity`,
      );
    }
  }
  return errors;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  for (const target of analyticsMinimizationTargets) {
    const result = project(target);
    console.log(
      `Projected minimization rules into ${relative(root, resolve(root, result.schemaPath))} ` +
        `(${result.events} events, ${result.scopes} allow-list scopes).`,
    );
  }
}
