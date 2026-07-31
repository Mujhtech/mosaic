/**
 * Records, per invalid fixture, which validation layer actually rejects it.
 *
 * Mosaic enforces contracts in two layers: the canonical JSON Schema, and a
 * semantic validator for rules JSON Schema cannot express (digest coverage,
 * reference resolution, graph cycles, cross-field arithmetic). An `invalid/`
 * directory mixes both kinds freely, which made two things impossible to see:
 *
 *   1. whether a fixture an SDK "handles" is exercising that SDK's schema
 *      decoder or a rule the SDK never implements; and
 *   2. whether a schema narrowing moved a fixture between layers -- exactly the
 *      Phase 6 defect class, where schema and semantic validator disagreed.
 *
 * Each `invalid/` directory therefore carries a generated `rejection-layers.json`
 * mapping fixture filename to `"schema"` or `"semantic"`, derived by actually
 * running every fixture against the pure schema with no semantic validator
 * attached. Fixtures are never moved between directories: the classification is
 * an observation, and an observation that changes should show up as a diff.
 *
 * Format (`docs/protocol/fixture-lifecycle.md` is normative):
 *
 *   {
 *     "contract": "<contract name and version>",
 *     "description": "...",
 *     "layers": { "<fixture>.json": "schema" | "semantic" }
 *   }
 *
 * Run via `npm run generate`; reconciled by `validateRejectionLayers()` in
 * `npm run validate`.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const REJECTION_LAYERS_FILENAME = "rejection-layers.json";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const schemaAt = (path) => read(resolve(root, path));

/**
 * Compiles one pure-schema validator. `supporting` schemas are registered only
 * so `$ref`s resolve; the returned validator is for `target`.
 */
function pureSchemaValidator(target, supporting = []) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  for (const schema of supporting) ajv.addSchema(schemaAt(schema));
  return ajv.compile(schemaAt(target));
}

const PAYWALL = "schema/v0.2/paywall.schema.json";
const DECISION = "schema/placement-decision/v1/decision.schema.json";
const EXPERIMENT = "schema/experiment-assignment/v1/assignment.schema.json";
const DELIVERY_V1 = [
  "schema/configuration-delivery/v1/release.schema.json",
  "schema/configuration-delivery/v1/capability-request.schema.json",
];
const DELIVERY_V2 = [
  "schema/configuration-delivery/v2/release.schema.json",
  "schema/configuration-delivery/v2/capability-request.schema.json",
];

const BILLING_INGESTION = [
  "schema/billing-ingestion/v1/observation.schema.json",
  "schema/billing-ingestion/v1/transaction-fact.schema.json",
  "schema/billing-ingestion/v1/submission-response.schema.json",
  "schema/billing-ingestion/v1/validation.schema.json",
];

/**
 * Billing Ingestion v1 is four sibling envelope schemas rather than one. Its
 * invalid fixtures are documents of all four, so the pure-schema probe is a
 * union: each schema pins its own `recordType` subset, so a well-formed record
 * matches exactly one branch and a rejected record matches none.
 */
function billingIngestionV1UnionValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  for (const schema of BILLING_INGESTION) ajv.addSchema(schemaAt(schema));
  return ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:mosaic:protocol:schema:billing-ingestion:v1:rejection-probe",
    anyOf: BILLING_INGESTION.map((schema) => ({
      $ref: schemaAt(schema).$id,
    })),
  });
}

const AUTHORITATIVE_ENTITLEMENT = [
  "schema/authoritative-entitlement/v1/snapshot.schema.json",
  "schema/authoritative-entitlement/v1/sync-request.schema.json",
  "schema/authoritative-entitlement/v1/check.schema.json",
  "schema/authoritative-entitlement/v1/subscription.schema.json",
  "schema/authoritative-entitlement/v1/restore.schema.json",
];

const BILLING_STATE_WEBHOOK = [
  "schema/billing-state-webhook/v1/event.schema.json",
  "schema/billing-state-webhook/v1/delivery.schema.json",
];

/**
 * Compiles a union probe for a contract whose invalid fixtures are documents of
 * several sibling envelope schemas. Each schema pins its own `recordType`
 * subset, so a well-formed record matches exactly one branch and a rejected
 * record matches none.
 */
function unionValidator(schemas) {
  return () => {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      strictTypes: false,
    });
    for (const schema of schemas) ajv.addSchema(schemaAt(schema));
    return ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `urn:mosaic:protocol:schema:rejection-probe:${schemas[0]}`,
      anyOf: schemas.map((schema) => ({ $ref: schemaAt(schema).$id })),
    });
  };
}

/**
 * Every `invalid/` fixture directory, with the pure schema its fixtures are
 * documents of. Kept explicit: a new contract must be registered deliberately,
 * and `validateRejectionLayers` fails if an `invalid/` directory exists with no
 * entry here.
 */
export const rejectionLayerTargets = Object.freeze([
  {
    contract: "Paywall Protocol 0.2",
    directory: "fixtures/v0.2/invalid",
    validator: () => pureSchemaValidator(PAYWALL),
  },
  {
    contract: "Configuration Delivery v1",
    directory: "fixtures/configuration-delivery/v1/invalid",
    validator: () => pureSchemaValidator(DELIVERY_V1[0], [PAYWALL]),
  },
  {
    contract: "Configuration Delivery v2",
    directory: "fixtures/configuration-delivery/v2/invalid",
    validator: () =>
      pureSchemaValidator(DELIVERY_V2[0], [PAYWALL, DECISION, ...DELIVERY_V1]),
  },
  {
    contract: "Configuration Delivery v3",
    directory: "fixtures/configuration-delivery/v3/invalid",
    validator: () =>
      pureSchemaValidator(
        "schema/configuration-delivery/v3/release.schema.json",
        [PAYWALL, DECISION, EXPERIMENT, ...DELIVERY_V1, ...DELIVERY_V2],
      ),
  },
  {
    contract: "Placement Decision v1",
    directory: "fixtures/placement-decision/v1/invalid",
    validator: () => pureSchemaValidator(DECISION),
  },
  {
    contract: "Experiment Assignment v1",
    directory: "fixtures/experiment-assignment/v1/invalid",
    validator: () => pureSchemaValidator(EXPERIMENT),
  },
  {
    contract: "Analytics Event v1",
    directory: "fixtures/analytics-event/v1/invalid",
    validator: () =>
      pureSchemaValidator("schema/analytics-event/v1/event.schema.json"),
  },
  {
    contract: "Analytics Event v2",
    directory: "fixtures/analytics-event/v2/invalid",
    validator: () =>
      pureSchemaValidator("schema/analytics-event/v2/event.schema.json"),
  },
  {
    contract: "Billing Ingestion v1",
    directory: "fixtures/billing-ingestion/v1/invalid",
    validator: billingIngestionV1UnionValidator,
  },
  {
    contract: "Authoritative Entitlement v1",
    directory: "fixtures/authoritative-entitlement/v1/invalid",
    validator: unionValidator(AUTHORITATIVE_ENTITLEMENT),
  },
  {
    contract: "Billing State Webhook v1",
    directory: "fixtures/billing-state-webhook/v1/invalid",
    validator: unionValidator(BILLING_STATE_WEBHOOK),
  },
  {
    contract: "Customer Access Token v1",
    directory: "fixtures/customer-access-token/v1/invalid",
    validator: () =>
      pureSchemaValidator("schema/customer-access-token/v1/token.schema.json"),
  },
  {
    contract: "Authoritative Entitlement v2",
    directory: "fixtures/authoritative-entitlement/v2/invalid",
    validator: () =>
      pureSchemaValidator(
        "schema/authoritative-entitlement/v2/contract.schema.json",
        ["schema/authoritative-entitlement/v1/snapshot.schema.json"],
      ),
  },
  {
    contract: "Billing Migration Operations v1",
    directory: "fixtures/billing-migration-operations/v1/invalid",
    validator: () =>
      pureSchemaValidator(
        "schema/billing-migration-operations/v1/contract.schema.json",
      ),
  },
  {
    contract: "Billing State Webhook v2",
    directory: "fixtures/billing-state-webhook/v2/invalid",
    validator: () =>
      pureSchemaValidator(
        "schema/billing-state-webhook/v2/contract.schema.json",
        [
          "schema/billing-state-webhook/v1/event.schema.json",
          "schema/billing-state-webhook/v1/delivery.schema.json",
        ],
      ),
  },
]);

const DESCRIPTION =
  "Generated by tools/generate-rejection-layers.mjs. For each invalid fixture, " +
  'the layer that rejects it: "schema" means the canonical JSON Schema alone ' +
  'rejects it; "semantic" means the schema accepts it and a semantic validator ' +
  "rule rejects it. See docs/protocol/fixture-lifecycle.md.";

export function fixtureNames(directory) {
  return readdirSync(resolve(root, directory))
    .filter(
      (name) => name.endsWith(".json") && name !== REJECTION_LAYERS_FILENAME,
    )
    .sort();
}

/** Probes each fixture in a directory against the pure schema. */
export function observeLayers(target) {
  const validate = target.validator();
  return Object.fromEntries(
    fixtureNames(target.directory).map((name) => [
      name,
      validate(read(resolve(root, target.directory, name)))
        ? "semantic"
        : "schema",
    ]),
  );
}

function documentFor(target) {
  return {
    contract: target.contract,
    description: DESCRIPTION,
    layers: observeLayers(target),
  };
}

function discoverInvalidDirectories(directory = "fixtures") {
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const child = `${directory}/${entry.name}`;
      return entry.name === "invalid"
        ? [child]
        : discoverInvalidDirectories(child);
    })
    .sort();
}

export function validateRejectionLayers() {
  const errors = [];
  const registered = new Set(
    rejectionLayerTargets.map((target) => target.directory),
  );
  for (const directory of discoverInvalidDirectories()) {
    if (!registered.has(directory)) {
      errors.push(
        `${directory} has no rejection-layer target registered in tools/generate-rejection-layers.mjs`,
      );
    }
  }
  for (const target of rejectionLayerTargets) {
    const path = resolve(root, target.directory, REJECTION_LAYERS_FILENAME);
    let committed;
    try {
      committed = readFileSync(path, "utf8");
    } catch {
      errors.push(
        `${relative(root, path)} is missing; run npm run generate:rejection-layers`,
      );
      continue;
    }
    const expected = `${JSON.stringify(documentFor(target), null, 2)}\n`;
    if (committed === expected) continue;
    const observed = observeLayers(target);
    const recorded = JSON.parse(committed).layers ?? {};
    let named = false;
    for (const name of [
      ...new Set([...Object.keys(observed), ...Object.keys(recorded)]),
    ].sort()) {
      if (recorded[name] !== observed[name]) {
        named = true;
        errors.push(
          `${relative(root, path)}: ${name} is recorded as "${recorded[name] ?? "absent"}" ` +
            `but is rejected by the ${observed[name] ?? "n/a"} layer`,
        );
      }
    }
    if (!named) {
      errors.push(`${relative(root, path)} is not canonical; regenerate it`);
    }
  }
  return errors;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  for (const target of rejectionLayerTargets) {
    const document = documentFor(target);
    const path = resolve(root, target.directory, REJECTION_LAYERS_FILENAME);
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    const counts = Object.values(document.layers).reduce(
      (totals, layer) => ({ ...totals, [layer]: (totals[layer] ?? 0) + 1 }),
      {},
    );
    console.log(
      `Recorded rejection layers for ${target.contract}: ` +
        `${counts.schema ?? 0} schema, ${counts.semantic ?? 0} semantic ` +
        `(${relative(root, path)}).`,
    );
  }
}
