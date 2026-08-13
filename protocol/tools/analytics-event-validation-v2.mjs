import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  focusedEventSchemaErrors,
  schemaErrors,
} from "./analytics-event-rules.mjs";
import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const analyticsEventV2Paths = Object.freeze({
  eventSchema: resolve(root, "schema/analytics-event/v2/event.schema.json"),
  batchSchema: resolve(root, "schema/analytics-event/v2/batch.schema.json"),
  responseSchema: resolve(root, "schema/analytics-event/v2/ingestion-response.schema.json"),
  manifestSchema: resolve(root, "schema/analytics-event/v2/compatibility-manifest.schema.json"),
  manifest: resolve(root, "compatibility/analytics-event/v2.json"),
  fixtureDirectory: resolve(root, "fixtures/analytics-event/v2"),
});
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
// `rejection-layers.json` is generated metadata about a directory's fixtures,
// not a fixture. See tools/generate-rejection-layers.mjs.
function jsonPaths(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const path = resolve(directory, entry.name); if (entry.isDirectory()) return jsonPaths(path); if (entry.name === REJECTION_LAYERS_FILENAME) return []; return entry.name.endsWith(".json") ? [path] : []; }).sort(); }
const duplicates = (values) => { const seen = new Set(); return values.filter((value) => seen.has(value) || !seen.add(value)); };

export function loadAnalyticsEventV2Artifacts() {
  const paths = jsonPaths(analyticsEventV2Paths.fixtureDirectory);
  const eventPaths = paths.filter((path) => !path.includes("/invalid/") && !path.includes("/batches/") && !path.includes("/responses/"));
  const invalidEventPaths = paths.filter((path) => path.includes("/invalid/"));
  const batchPaths = paths.filter((path) => path.includes("/batches/"));
  const responsePaths = paths.filter((path) => path.includes("/responses/"));
  return {
    eventSchema: read(analyticsEventV2Paths.eventSchema), batchSchema: read(analyticsEventV2Paths.batchSchema), responseSchema: read(analyticsEventV2Paths.responseSchema),
    manifestSchema: read(analyticsEventV2Paths.manifestSchema), manifest: read(analyticsEventV2Paths.manifest), paths, eventPaths, invalidEventPaths, batchPaths, responsePaths,
    events: eventPaths.map(read), invalidEvents: invalidEventPaths.map(read), batches: batchPaths.map(read), responses: responsePaths.map(read),
  };
}

function validators(artifacts) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  for (const schema of [artifacts.eventSchema, artifacts.batchSchema, artifacts.responseSchema, artifacts.manifestSchema]) ajv.addSchema(schema);
  return { event: ajv.getSchema(artifacts.eventSchema.$id), batch: ajv.getSchema(artifacts.batchSchema.$id), response: ajv.getSchema(artifacts.responseSchema.$id), manifest: ajv.getSchema(artifacts.manifestSchema.$id) };
}

const experimentTuple = ["experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"];
const placement = ["configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion", "winningRuleId"];
const paywall = [...placement, "paywallId", "paywallVersionId"];
const product = [...paywall, "mosaicProductId", "planId", "providerId", "providerProductMappingId"];
const experimentNames = new Set(["experiment_assigned", "experiment_exposed", "experiment_fallback_presented", "experiment_assignment_failed"]);
const productAndPurchase = new Set(["product_selected", "purchase_started", "purchase_completed_client", "purchase_completed_provider", "purchase_pending", "purchase_deferred", "purchase_cancelled", "purchase_failed"]);
const allowedExperimentAttribution = {
  experiment_assigned: [...placement, ...experimentTuple],
  experiment_exposed: [...paywall, ...experimentTuple],
  experiment_fallback_presented: [...placement, ...experimentTuple],
  experiment_assignment_failed: [...placement, ...experimentTuple],
};
export const analyticsEventV2CorrelationAllowLists = Object.freeze({
  placement_requested: ["placementRequestId"], placement_paywall_selected: ["placementRequestId"], placement_no_paywall: ["placementRequestId"], placement_fallback_used: ["placementRequestId"], placement_unavailable: ["placementRequestId"], placement_evaluation_failed: ["placementRequestId"],
  paywall_presented: ["placementRequestId", "paywallPresentationId"], paywall_dismissed: ["placementRequestId", "paywallPresentationId"], paywall_action_selected: ["placementRequestId", "paywallPresentationId"], paywall_render_failed: ["placementRequestId", "paywallPresentationId"],
  product_load_started: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"], product_load_completed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"], product_load_failed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"], product_unavailable: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"], product_selected: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId"],
  purchase_started: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"], purchase_completed_client: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"], purchase_completed_provider: ["purchaseAttemptId", "providerOperationId", "providerUpdateId"], purchase_pending: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"], purchase_deferred: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"], purchase_cancelled: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"], purchase_failed: ["placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"],
  restore_started: ["restoreAttemptId", "providerOperationId"], restore_completed: ["restoreAttemptId", "providerOperationId"], restore_nothing_found: ["restoreAttemptId", "providerOperationId"], restore_cancelled: ["restoreAttemptId", "providerOperationId"], restore_failed: ["restoreAttemptId", "providerOperationId"],
  experiment_assigned: ["placementRequestId"], experiment_exposed: ["placementRequestId", "paywallPresentationId"], experiment_fallback_presented: ["placementRequestId", "paywallPresentationId"], experiment_assignment_failed: ["placementRequestId"],
});
export const analyticsEventV2AttributionAllowLists = Object.freeze({
  placement_requested: placement.filter((field) => field !== "winningRuleId"), placement_paywall_selected: paywall, placement_no_paywall: placement, placement_fallback_used: paywall, placement_unavailable: placement, placement_evaluation_failed: placement.filter((field) => field !== "winningRuleId"),
  paywall_presented: paywall, paywall_dismissed: paywall, paywall_action_selected: paywall, paywall_render_failed: paywall,
  product_load_started: paywall, product_load_completed: paywall, product_load_failed: paywall, product_unavailable: product, product_selected: product.concat(experimentTuple),
  purchase_started: product.concat(experimentTuple), purchase_completed_client: product.concat(experimentTuple), purchase_completed_provider: product.concat(experimentTuple), purchase_pending: product.concat(experimentTuple), purchase_deferred: product.concat(experimentTuple), purchase_cancelled: product.concat(experimentTuple), purchase_failed: product.concat(experimentTuple),
  restore_started: ["configurationReleaseId"], restore_completed: ["configurationReleaseId"], restore_nothing_found: ["configurationReleaseId"], restore_cancelled: ["configurationReleaseId"], restore_failed: ["configurationReleaseId"],
  ...allowedExperimentAttribution,
});
function semantics(event) {
  const errors = [];
  const present = experimentTuple.filter((field) => event.attribution?.[field] !== undefined);
  if (present.length !== 0 && present.length !== experimentTuple.length) errors.push(`${event.eventId} Experiment attribution must be absent or complete`);
  if (experimentNames.has(event.eventName) && present.length !== experimentTuple.length) errors.push(`${event.eventId} Experiment event requires immutable attribution`);
  if (present.length > 0 && !experimentNames.has(event.eventName) && !productAndPurchase.has(event.eventName)) errors.push(`${event.eventId} Experiment attribution is not allowed for ${event.eventName}`);
  for (const field of Object.keys(event.correlation ?? {})) if (!analyticsEventV2CorrelationAllowLists[event.eventName]?.includes(field)) errors.push(`${event.eventId} correlation.${field} is not allowed for ${event.eventName}`);
  for (const field of Object.keys(event.attribution ?? {})) if (!analyticsEventV2AttributionAllowLists[event.eventName]?.includes(field)) errors.push(`${event.eventId} attribution.${field} is not allowed for ${event.eventName}`);
  const hasRuleSetId = event.attribution?.placementRuleSetId !== undefined;
  const hasRuleSetVersion = event.attribution?.placementRuleSetVersion !== undefined;
  if (hasRuleSetId !== hasRuleSetVersion) errors.push(`${event.eventId} Rule Set attribution must include ID and version`);
  if (event.attribution?.winningRuleId !== undefined && !hasRuleSetId) errors.push(`${event.eventId} winning Rule attribution requires exact Rule Set identity`);
  if (event.eventName !== "purchase_completed_provider" && event.authority !== "client_observed") errors.push(`${event.eventId} client event cannot use trusted source authority`);
  if (["placement_paywall_selected", "placement_no_paywall"].includes(event.eventName)) {
    const rollout = [event.payload.assignmentKeyType, event.payload.bucketingAlgorithm, event.payload.rolloutBucket].filter((value) => value !== undefined).length;
    if (rollout !== 0 && rollout !== 3) errors.push(`${event.eventId} rollout attribution must be absent or complete`);
  }
  if (event.eventName === "experiment_exposed" && event.payload.qaOverride === true) errors.push(`${event.eventId} QA presentation must not emit statistical exposure`);
  if (event.eventName === "experiment_fallback_presented" && (event.attribution.paywallId !== undefined || event.attribution.paywallVersionId !== undefined)) errors.push(`${event.eventId} fallback actual Paywall belongs only in presented identity payload`);
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > 32768) errors.push(`${event.eventId} exceeds 32 KiB`);
  return errors;
}

export function validateAnalyticsEventV2Event(event, artifacts = loadAnalyticsEventV2Artifacts()) {
  const validate = validators(artifacts).event;
  return validate(event) ? semantics(event) : focusedEventSchemaErrors(`event ${event?.eventId ?? "unknown"}`, event, artifacts.eventSchema, validate.errors);
}
export function validateAnalyticsEventV2Batch(batch, artifacts = loadAnalyticsEventV2Artifacts()) {
  const validate = validators(artifacts).batch;
  if (!validate(batch)) return schemaErrors(`batch ${batch?.batchId ?? "unknown"}`, validate.errors);
  const errors = duplicates(batch.events.map((event) => event.eventId)).map((id) => `${batch.batchId} contains duplicate event ID ${id}`);
  if (Buffer.byteLength(JSON.stringify(batch), "utf8") > 524288) errors.push(`${batch.batchId} exceeds 512 KiB`);
  for (const event of batch.events) errors.push(...semantics(event));
  return errors;
}

export function validateAnalyticsEventV2Artifacts(artifacts = loadAnalyticsEventV2Artifacts()) {
  const compiled = validators(artifacts); const errors = [];
  if (!compiled.manifest(artifacts.manifest)) errors.push(...schemaErrors("manifest", compiled.manifest.errors));
  const names = artifacts.manifest.eventSchemas.map((entry) => entry.eventName);
  if (duplicates(names).length || names.length !== artifacts.eventSchema.$defs.eventName.enum.length || artifacts.eventSchema.$defs.eventName.enum.some((name) => !names.includes(name))) errors.push("Analytics v2 manifest taxonomy is not exact");
  for (const event of artifacts.events) errors.push(...validateAnalyticsEventV2Event(event, artifacts));
  for (const event of artifacts.invalidEvents) if (validateAnalyticsEventV2Event(event, artifacts).length === 0) errors.push(`invalid event ${event.eventId} was accepted`);
  for (const batch of artifacts.batches) errors.push(...validateAnalyticsEventV2Batch(batch, artifacts));
  for (const response of artifacts.responses) if (!compiled.response(response)) errors.push(...schemaErrors(`response ${response.batchId}`, compiled.response.errors));
  const directory = dirname(analyticsEventV2Paths.manifest);
  for (const path of [...Object.values(artifacts.manifest.schemas), ...artifacts.manifest.canonicalFixtures]) if (!existsSync(resolve(directory, path))) errors.push(`manifest path does not exist: ${path}`);
  errors.push(...corpusCoverage(artifacts));
  return errors;
}

/**
 * The number of distinct event names the canonical corpus exercises.
 *
 * A floor rather than the full taxonomy: 11 of the 31 declared names have never
 * had a canonical fixture, and inventing one apiece would assert conformance
 * over documents nobody derived from a real emission. The floor is what stops
 * the corpus shrinking silently -- which is exactly what happened when the
 * Contract 1 base fixtures were deleted and only the Experiment delta remained,
 * leaving every non-Experiment event name uncovered while this validator still
 * reported success. Raise it when the corpus grows; never lower it to make a
 * check pass.
 */
export const ANALYTICS_EVENT_NAME_COVERAGE_FLOOR = 20;

function corpusCoverage(artifacts) {
  const errors = [];
  const names = new Set();
  for (const event of artifacts.events) names.add(event.eventName);
  for (const batch of artifacts.batches) for (const event of batch.events) names.add(event.eventName);
  if (names.size < ANALYTICS_EVENT_NAME_COVERAGE_FLOOR) {
    errors.push(`canonical corpus exercises ${names.size} event names but the contract declares a floor of ${ANALYTICS_EVENT_NAME_COVERAGE_FLOOR}`);
  }
  for (const name of names) {
    if (artifacts.eventSchema.$defs.eventName.enum.includes(name)) continue;
    errors.push(`canonical corpus exercises unknown event name ${name}`);
  }

  // One representative per family. A corpus that lost every purchase event
  // while keeping enough Experiment events to clear the floor would still be
  // missing the half the SDKs emit most.
  const families = { placement: /^placement_/u, paywall: /^paywall_/u, product: /^product_/u, purchase: /^purchase_/u, restore: /^restore_/u, experiment: /^experiment_/u };
  for (const [family, pattern] of Object.entries(families)) {
    if ([...names].some((name) => pattern.test(name))) continue;
    errors.push(`canonical corpus exercises no ${family} event`);
  }

  // Both authorities: `provider_confirmed` is the one authority a public SDK
  // may never claim, and the rule that enforces it is unreachable without a
  // fixture that legitimately carries it.
  const authorities = new Set(artifacts.events.map((event) => event.authority));
  for (const authority of ["client_observed", "provider_confirmed"]) {
    if (authorities.has(authority)) continue;
    errors.push(`canonical corpus exercises no ${authority} event`);
  }

  // Partial-batch ingestion is per-event, so every result status must appear or
  // the classification a client branches on is pinned by nothing.
  const statuses = new Set(artifacts.responses.flatMap((response) => response.results.map((result) => result.status)));
  for (const status of ["accepted", "duplicate", "retryable", "permanently_rejected"]) {
    if (statuses.has(status)) continue;
    errors.push(`canonical corpus exercises no ${status} ingestion result`);
  }
  return errors;
}

export function validateAnalyticsEventV2JsonFormatting() {
  const paths = [analyticsEventV2Paths.eventSchema, analyticsEventV2Paths.batchSchema, analyticsEventV2Paths.responseSchema, analyticsEventV2Paths.manifestSchema, analyticsEventV2Paths.manifest, ...jsonPaths(analyticsEventV2Paths.fixtureDirectory)];
  return paths.flatMap((path) => readFileSync(path, "utf8") === `${JSON.stringify(read(path), null, 2)}\n` ? [] : [`${relative(root, path)} is not canonical JSON`]);
}
