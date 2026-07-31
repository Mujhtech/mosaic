import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const analyticsEventV1Root = resolve(toolsDirectory, "..");

export const analyticsEventV1Paths = Object.freeze({
  eventSchema: resolve(
    analyticsEventV1Root,
    "schema/analytics-event/v1/event.schema.json",
  ),
  batchSchema: resolve(
    analyticsEventV1Root,
    "schema/analytics-event/v1/batch.schema.json",
  ),
  ingestionResponseSchema: resolve(
    analyticsEventV1Root,
    "schema/analytics-event/v1/ingestion-response.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    analyticsEventV1Root,
    "schema/analytics-event/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    analyticsEventV1Root,
    "compatibility/analytics-event/v1.json",
  ),
  fixtureDirectory: resolve(
    analyticsEventV1Root,
    "fixtures/analytics-event/v1",
  ),
});

export function readAnalyticsEventV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function jsonPaths(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return jsonPaths(path);
      // `rejection-layers.json` is generated metadata about the fixtures in a
      // directory, not a fixture. See tools/generate-rejection-layers.mjs.
      if (entry.name === REJECTION_LAYERS_FILENAME) return [];
      return entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

export function loadAnalyticsEventV1Artifacts() {
  const fixturePaths = jsonPaths(analyticsEventV1Paths.fixtureDirectory);
  const eventFixturePaths = fixturePaths.filter(
    (path) =>
      !path.includes("/invalid/") &&
      !path.includes("/responses/") &&
      !path.includes("/batches/"),
  );
  const invalidEventFixturePaths = fixturePaths.filter((path) =>
    path.includes("/invalid/"),
  );
  const batchFixturePaths = fixturePaths.filter((path) =>
    path.includes("/batches/"),
  );
  const responseFixturePaths = fixturePaths.filter((path) =>
    path.includes("/responses/"),
  );
  return {
    eventSchema: readAnalyticsEventV1Json(analyticsEventV1Paths.eventSchema),
    batchSchema: readAnalyticsEventV1Json(analyticsEventV1Paths.batchSchema),
    ingestionResponseSchema: readAnalyticsEventV1Json(
      analyticsEventV1Paths.ingestionResponseSchema,
    ),
    compatibilityManifestSchema: readAnalyticsEventV1Json(
      analyticsEventV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readAnalyticsEventV1Json(
      analyticsEventV1Paths.compatibilityManifest,
    ),
    fixturePaths,
    eventFixturePaths,
    invalidEventFixturePaths,
    batchFixturePaths,
    responseFixturePaths,
    eventFixtures: eventFixturePaths.map(readAnalyticsEventV1Json),
    invalidEventFixtures: invalidEventFixturePaths.map(readAnalyticsEventV1Json),
    batchFixtures: batchFixturePaths.map(readAnalyticsEventV1Json),
    responseFixtures: responseFixturePaths.map(readAnalyticsEventV1Json),
  };
}

function validators(artifacts) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  for (const schema of [
    artifacts.eventSchema,
    artifacts.batchSchema,
    artifacts.ingestionResponseSchema,
    artifacts.compatibilityManifestSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return {
    event: ajv.getSchema(artifacts.eventSchema.$id),
    batch: ajv.getSchema(artifacts.batchSchema.$id),
    response: ajv.getSchema(artifacts.ingestionResponseSchema.$id),
    manifest: ajv.getSchema(artifacts.compatibilityManifestSchema.$id),
  };
}

/**
 * Names the offending property for allow-list violations. Ajv reports the
 * rejected key in `params`, not in `message`, so a bare message would tell an
 * operator only that "an" unevaluated property exists. Minimization rejections
 * are only actionable if the diagnostic names the field.
 */
export function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) {
    return `${at}.${offending} is not allowed`;
  }
  return `${at} ${error.message ?? "is invalid"}`;
}

function schemaErrors(label, errors = []) {
  // "must match exactly one schema in oneOf" restates the taxonomy dispatch and
  // adds nothing once a specific cause is reported.
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [...new Set(reported.map((error) => describeSchemaError(label, error)))];
}

/** Maps `eventName` to the `$defs` branch that declares it. */
function branchDefinitions(eventSchema) {
  const declared = (node) => {
    if (node === null || typeof node !== "object") return undefined;
    const name = node.properties?.eventName?.const;
    if (typeof name === "string") return name;
    for (const composed of node.allOf ?? []) {
      const found = declared(composed);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return new Map(
    Object.entries(eventSchema.$defs)
      .map(([defName, def]) => [declared(def), defName])
      .filter(([eventName]) => eventName !== undefined),
  );
}

const focusedValidatorCache = new Map();

/**
 * The event schema is a 27-way (v2: 31-way) `oneOf` over `$ref` branches, so a
 * single bad field makes Ajv emit every branch's failures -- roughly 150 lines,
 * nearly all of them complaining that the document is not some other event
 * type. An operator cannot act on that.
 *
 * Once the verdict is known to be "reject", revalidate against a copy of the
 * schema whose `oneOf` contains only the branch matching the document's own
 * `eventName`. That yields the handful of errors the author actually needs.
 * Reporting only -- the accept/reject verdict always comes from the full schema.
 */
export function focusedEventSchemaErrors(label, event, eventSchema, fallback) {
  const defName = branchDefinitions(eventSchema).get(event?.eventName);
  if (defName === undefined) return schemaErrors(label, fallback);
  const cacheKey = `${eventSchema.$id}#${defName}`;
  let validate = focusedValidatorCache.get(cacheKey);
  if (validate === undefined) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      strictTypes: false,
    });
    validate = ajv.compile({
      ...eventSchema,
      $id: `${eventSchema.$id}:focused:${defName}`,
      oneOf: [{ $ref: `#/$defs/${defName}` }],
    });
    focusedValidatorCache.set(cacheKey, validate);
  }
  if (validate(event)) return schemaErrors(label, fallback);
  return schemaErrors(label, validate.errors);
}

function duplicates(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export const analyticsEventV1CorrelationAllowLists = Object.freeze({
  placement_requested: ["placementRequestId"],
  placement_paywall_selected: ["placementRequestId"],
  placement_no_paywall: ["placementRequestId"],
  placement_fallback_used: ["placementRequestId"],
  placement_unavailable: ["placementRequestId"],
  placement_evaluation_failed: ["placementRequestId"],
  paywall_presented: ["placementRequestId", "paywallPresentationId"],
  paywall_dismissed: ["placementRequestId", "paywallPresentationId"],
  paywall_action_selected: ["placementRequestId", "paywallPresentationId"],
  paywall_render_failed: ["placementRequestId", "paywallPresentationId"],
  product_load_started: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  product_load_completed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  product_load_failed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  product_unavailable: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  product_selected: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  purchase_started: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  purchase_completed_client: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  purchase_completed_provider: ["purchaseAttemptId", "providerOperationId", "providerUpdateId"],
  purchase_pending: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  purchase_deferred: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  purchase_cancelled: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  purchase_failed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  restore_started: ["restoreAttemptId", "providerOperationId"],
  restore_completed: ["restoreAttemptId", "providerOperationId"],
  restore_nothing_found: ["restoreAttemptId", "providerOperationId"],
  restore_cancelled: ["restoreAttemptId", "providerOperationId"],
  restore_failed: ["restoreAttemptId", "providerOperationId"],
});

const placementAttribution = [
  "configurationReleaseId", "placementId", "placementRuleSetId",
  "placementRuleSetVersion", "winningRuleId",
];
const paywallAttribution = [...placementAttribution, "paywallId", "paywallVersionId"];
const productAttribution = [
  ...paywallAttribution, "mosaicProductId", "planId", "providerId",
  "providerProductMappingId",
];

export const analyticsEventV1AttributionAllowLists = Object.freeze({
  placement_requested: placementAttribution.filter((field) => field !== "winningRuleId"),
  placement_paywall_selected: paywallAttribution,
  placement_no_paywall: placementAttribution,
  placement_fallback_used: paywallAttribution,
  placement_unavailable: placementAttribution,
  placement_evaluation_failed: placementAttribution.filter((field) => field !== "winningRuleId"),
  paywall_presented: paywallAttribution,
  paywall_dismissed: paywallAttribution,
  paywall_action_selected: paywallAttribution,
  paywall_render_failed: paywallAttribution,
  product_load_started: paywallAttribution,
  product_load_completed: paywallAttribution,
  product_load_failed: paywallAttribution,
  product_unavailable: productAttribution,
  product_selected: productAttribution,
  purchase_started: productAttribution,
  purchase_completed_client: productAttribution,
  purchase_completed_provider: productAttribution,
  purchase_pending: productAttribution,
  purchase_deferred: productAttribution,
  purchase_cancelled: productAttribution,
  purchase_failed: productAttribution,
  restore_started: ["configurationReleaseId"],
  restore_completed: ["configurationReleaseId"],
  restore_nothing_found: ["configurationReleaseId"],
  restore_cancelled: ["configurationReleaseId"],
  restore_failed: ["configurationReleaseId"],
});

function unexpectedFields(value, allowed) {
  const allowList = new Set(allowed);
  return Object.keys(value ?? {}).filter((field) => !allowList.has(field));
}

function eventSemantics(event) {
  const errors = [];
  if (encodedBytes(event) > 32_768) {
    errors.push(`${event.eventId ?? "event"} exceeds the 32 KiB event limit`);
  }

  if (
    event.eventName === "purchase_completed_provider" &&
    event.authority === "client_observed"
  ) {
    errors.push(
      `${event.eventId} provider completion cannot use client_observed authority`,
    );
  }

  for (const field of unexpectedFields(
    event.correlation,
    analyticsEventV1CorrelationAllowLists[event.eventName] ?? [],
  )) {
    errors.push(`${event.eventId} correlation.${field} is not allowed for ${event.eventName}`);
  }
  for (const field of unexpectedFields(
    event.attribution,
    analyticsEventV1AttributionAllowLists[event.eventName] ?? [],
  )) {
    errors.push(`${event.eventId} attribution.${field} is not allowed for ${event.eventName}`);
  }

  const hasRuleSetId = event.attribution?.placementRuleSetId !== undefined;
  const hasRuleSetVersion = event.attribution?.placementRuleSetVersion !== undefined;
  if (hasRuleSetId !== hasRuleSetVersion) {
    errors.push(`${event.eventId} Rule Set attribution must include both ID and version`);
  }
  if (event.attribution?.winningRuleId !== undefined && !hasRuleSetId) {
    errors.push(`${event.eventId} winning Rule attribution requires exact Rule Set identity`);
  }
  if (
    event.eventName !== "purchase_completed_provider" &&
    event.authority !== "client_observed"
  ) {
    errors.push(
      `${event.eventId} client event cannot use trusted source authority`,
    );
  }

  const selection = new Set([
    "placement_paywall_selected",
    "placement_no_paywall",
  ]);
  if (selection.has(event.eventName)) {
    const values = [
      event.payload.assignmentKeyType,
      event.payload.bucketingAlgorithm,
      event.payload.rolloutBucket,
    ];
    const count = values.filter((value) => value !== undefined).length;
    if (count !== 0 && count !== values.length) {
      errors.push(
        `${event.eventId} rollout attribution must be absent or complete`,
      );
    }
  }

  if (event.eventName === "product_load_completed") {
    if (
      event.payload.availableProductCount +
        event.payload.unavailableProductCount >
      64
    ) {
      errors.push(`${event.eventId} resolved Product count exceeds 64`);
    }
  }
  return errors;
}

export function validateAnalyticsEventV1Event(event, artifacts) {
  const validate = validators(artifacts).event;
  if (!validate(event)) {
    return focusedEventSchemaErrors(
      `Analytics event ${event?.eventId ?? "event"}`,
      event,
      artifacts.eventSchema,
      validate.errors,
    );
  }
  return eventSemantics(event);
}

export function validateAnalyticsEventV1Batch(batch, artifacts) {
  const validate = validators(artifacts).batch;
  if (!validate(batch)) {
    return schemaErrors(
      `Analytics batch ${batch?.batchId ?? "batch"}`,
      validate.errors,
    );
  }
  const errors = [];
  for (const eventId of duplicates(batch.events.map((event) => event.eventId))) {
    errors.push(`${batch.batchId} contains duplicate event ID ${eventId}`);
  }
  if (encodedBytes(batch) > 524_288) {
    errors.push(`${batch.batchId} exceeds the 512 KiB batch limit`);
  }
  for (const event of batch.events) {
    errors.push(...eventSemantics(event));
  }
  return errors;
}

export function validateAnalyticsEventV1Response(response, artifacts) {
  const validate = validators(artifacts).response;
  if (!validate(response)) {
    return schemaErrors(
      `Analytics response ${response?.batchId ?? "response"}`,
      validate.errors,
    );
  }
  const errors = [];
  for (const eventId of duplicates(response.results.map((result) => result.eventId))) {
    errors.push(`${response.batchId} repeats result for event ID ${eventId}`);
  }
  return errors;
}

function validateCompatibility(artifacts) {
  const validate = validators(artifacts).manifest;
  if (!validate(artifacts.compatibilityManifest)) {
    return schemaErrors("Analytics compatibility manifest", validate.errors);
  }
  const errors = [];
  const names = artifacts.compatibilityManifest.eventSchemas.map(
    (entry) => entry.eventName,
  );
  for (const eventName of duplicates(names)) {
    errors.push(`Analytics compatibility repeats event ${eventName}`);
  }
  const declaredNames = artifacts.eventSchema.$defs.eventName.enum;
  if (
    names.length !== declaredNames.length ||
    declaredNames.some((name) => !names.includes(name))
  ) {
    errors.push("Analytics compatibility event taxonomy is incomplete");
  }
  const manifestDirectory = dirname(analyticsEventV1Paths.compatibilityManifest);
  for (const path of [
    ...Object.values(artifacts.compatibilityManifest.schemas),
    ...artifacts.compatibilityManifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Analytics compatibility path does not exist: ${path}`);
    }
  }
  return errors;
}

export function validateAnalyticsEventV1Artifacts(artifacts) {
  const compiled = validators(artifacts);
  const errors = [...validateCompatibility(artifacts)];
  for (const [index, event] of artifacts.eventFixtures.entries()) {
    if (!compiled.event(event)) {
      errors.push(
        ...focusedEventSchemaErrors(
          `Analytics fixture ${relative(analyticsEventV1Root, artifacts.eventFixturePaths[index])}`,
          event,
          artifacts.eventSchema,
          compiled.event.errors,
        ),
      );
    } else {
      errors.push(...eventSemantics(event));
    }
  }
  for (const [index, event] of artifacts.invalidEventFixtures.entries()) {
    if (compiled.event(event) && eventSemantics(event).length === 0) {
      errors.push(
        `Invalid Analytics fixture ${relative(analyticsEventV1Root, artifacts.invalidEventFixturePaths[index])} was accepted`,
      );
    }
  }
  for (const [index, batch] of artifacts.batchFixtures.entries()) {
    if (!compiled.batch(batch)) {
      errors.push(
        ...schemaErrors(
          `Analytics fixture ${relative(analyticsEventV1Root, artifacts.batchFixturePaths[index])}`,
          compiled.batch.errors,
        ),
      );
    } else {
      errors.push(...validateAnalyticsEventV1Batch(batch, artifacts));
    }
  }
  for (const [index, response] of artifacts.responseFixtures.entries()) {
    if (!compiled.response(response)) {
      errors.push(
        ...schemaErrors(
          `Analytics fixture ${relative(analyticsEventV1Root, artifacts.responseFixturePaths[index])}`,
          compiled.response.errors,
        ),
      );
    }
    for (const eventId of duplicates(response.results.map((result) => result.eventId))) {
      errors.push(`${response.batchId} repeats result for event ID ${eventId}`);
    }
  }
  return errors;
}

export function validateAnalyticsEventV1JsonFormatting() {
  const paths = [
    analyticsEventV1Paths.eventSchema,
    analyticsEventV1Paths.batchSchema,
    analyticsEventV1Paths.ingestionResponseSchema,
    analyticsEventV1Paths.compatibilityManifestSchema,
    analyticsEventV1Paths.compatibilityManifest,
    ...jsonPaths(analyticsEventV1Paths.fixtureDirectory),
  ];
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const canonical = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    return source === canonical
      ? []
      : [`${relative(analyticsEventV1Root, path)} is not canonical JSON`];
  });
}
