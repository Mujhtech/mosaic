/**
 * Billing State Webhook Contract v1 validation.
 *
 * Two canonical schemas plus a compatibility manifest. The event is what Mosaic
 * transmits; the delivery attempt is what operators read and is never
 * transmitted at all.
 *
 * The semantic layer covers what JSON Schema cannot: time ordering, snapshot
 * monotonicity, retry arithmetic, response-code agreement, and the rule that an
 * event must actually report a change. It also carries three guards on the
 * contract itself rather than on any document -- no event type may name a
 * provider, the emitted set must be a subset of the declared vocabulary, and a
 * summarized access state may never be `unavailable` -- plus the
 * forbidden-value walk ported from Billing Ingestion. Only the *values*
 * are ported: Billing Ingestion also bans entitlement and subscription field
 * names, which here would ban the entire contract.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const billingStateWebhookV1Root = resolve(toolsDirectory, "..");

const schemaPath = (name) =>
  resolve(
    billingStateWebhookV1Root,
    `schema/billing-state-webhook/v1/${name}.schema.json`,
  );

export const billingStateWebhookV1Paths = Object.freeze({
  eventSchema: schemaPath("event"),
  deliverySchema: schemaPath("delivery"),
  compatibilityManifestSchema: schemaPath("compatibility-manifest"),
  compatibilityManifest: resolve(
    billingStateWebhookV1Root,
    "compatibility/billing-state-webhook/v1.json",
  ),
  fixtureDirectory: resolve(
    billingStateWebhookV1Root,
    "fixtures/billing-state-webhook/v1",
  ),
});

const FIXTURE_FAMILIES = Object.freeze({
  events: "event",
  deliveries: "delivery",
});

const FAMILY_RECORD_TYPES = Object.freeze({
  event: ["billingStateEvent"],
  delivery: ["webhookDeliveryAttempt"],
});

/**
 * Reasons a committed change may leave every Entitlement state untouched. A
 * period extension and a cancellation are real changes an application backend
 * wants to hear about even though nothing gained or lost access.
 */
const NON_STATE_CHANGE_REASONS = Object.freeze([
  "subscription_period_changed",
  "renewal_intent_changed",
  "grant_version_changed",
]);

export function readBillingStateWebhookV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function jsonPaths(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return jsonPaths(path);
      if (entry.name === REJECTION_LAYERS_FILENAME) return [];
      return entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

function familyOf(path) {
  const directory = dirname(
    relative(billingStateWebhookV1Paths.fixtureDirectory, path),
  );
  return FIXTURE_FAMILIES[directory];
}

export function loadBillingStateWebhookV1Artifacts() {
  const fixturePaths = jsonPaths(billingStateWebhookV1Paths.fixtureDirectory);
  const validFixturePaths = fixturePaths.filter(
    (path) => !path.includes("/invalid/"),
  );
  const invalidFixturePaths = fixturePaths.filter((path) =>
    path.includes("/invalid/"),
  );
  return {
    eventSchema: readBillingStateWebhookV1Json(
      billingStateWebhookV1Paths.eventSchema,
    ),
    deliverySchema: readBillingStateWebhookV1Json(
      billingStateWebhookV1Paths.deliverySchema,
    ),
    compatibilityManifestSchema: readBillingStateWebhookV1Json(
      billingStateWebhookV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readBillingStateWebhookV1Json(
      billingStateWebhookV1Paths.compatibilityManifest,
    ),
    fixturePaths,
    validFixturePaths,
    invalidFixturePaths,
    validFixtures: validFixturePaths.map(readBillingStateWebhookV1Json),
    invalidFixtures: invalidFixturePaths.map(readBillingStateWebhookV1Json),
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
    artifacts.deliverySchema,
    artifacts.compatibilityManifestSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return {
    event: ajv.getSchema(artifacts.eventSchema.$id),
    delivery: ajv.getSchema(artifacts.deliverySchema.$id),
    manifest: ajv.getSchema(artifacts.compatibilityManifestSchema.$id),
  };
}

function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) return `${at}.${offending} is not allowed`;
  return `${at} ${error.message ?? "is invalid"}`;
}

function schemaErrors(label, errors = []) {
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [
    ...new Set(reported.map((error) => describeSchemaError(label, error))),
  ];
}

const JWS_SHAPE = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;

function walkValues(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValues(item, `${path}/${index}`, visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkValues(child, `${path}/${key}`, visit);
    }
  }
}

function notAfter(earlier, later) {
  return Date.parse(earlier) <= Date.parse(later);
}

function ascending(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function eventSemantics(label, payload) {
  const errors = [];
  if (!notAfter(payload.occurredAt, payload.createdAt)) {
    errors.push(`${label} was created before the change it reports occurred`);
  }
  if (
    payload.previousSnapshotVersion !== undefined &&
    payload.snapshotVersion <= payload.previousSnapshotVersion
  ) {
    errors.push(
      `${label} snapshotVersion ${payload.snapshotVersion} does not advance past ` +
        `previousSnapshotVersion ${payload.previousSnapshotVersion}; a consumer orders by this value`,
    );
  }
  const keys = payload.changedEntitlements.map((item) => item.entitlementKey);
  if (!ascending(keys)) {
    errors.push(
      `${label} changedEntitlements are not ascending and unique by entitlementKey`,
    );
  }
  const changedState = payload.changedEntitlements.some(
    (item) => item.previousState !== item.currentState,
  );
  if (
    payload.changedEntitlements.length > 0 &&
    !changedState &&
    !NON_STATE_CHANGE_REASONS.includes(payload.sourceReason)
  ) {
    errors.push(
      `${label} reports no state change under sourceReason ${payload.sourceReason}; ` +
        "an event that changes nothing is a no-change projection, which emits no webhook",
    );
  }
  return errors;
}

function deliverySemantics(label, payload) {
  const errors = [];
  if (payload.attempt > payload.maxAttempts) {
    errors.push(`${label} attempt exceeds maxAttempts`);
  }
  if (payload.status === "exhausted" && payload.attempt !== payload.maxAttempts) {
    errors.push(
      `${label} is exhausted on attempt ${payload.attempt} of ${payload.maxAttempts}; ` +
        "exhaustion means the attempts actually ran out",
    );
  }
  if (
    payload.respondedAt !== undefined &&
    !notAfter(payload.requestedAt, payload.respondedAt)
  ) {
    errors.push(`${label} was answered before it was sent`);
  }
  if (
    payload.nextAttemptAt !== undefined &&
    !notAfter(payload.requestedAt, payload.nextAttemptAt)
  ) {
    errors.push(`${label} schedules its next attempt before this one was sent`);
  }
  const code = payload.responseStatusCode;
  if (code !== undefined) {
    const success = code >= 200 && code <= 299;
    if (payload.status === "succeeded" && !success) {
      errors.push(`${label} succeeded with response status ${code}`);
    }
    if (
      (payload.status === "failed" || payload.status === "exhausted") &&
      success
    ) {
      errors.push(`${label} failed with response status ${code}`);
    }
  }
  return errors;
}

function recordSemantics(label, document) {
  const errors = [];
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > 32_768) {
    errors.push(`${label} exceeds the 32 KiB record limit`);
  }
  walkValues(document, "", (value, path) => {
    if (JWS_SHAPE.test(value)) {
      errors.push(
        `${label}${path} carries a signed-payload-shaped value; no provider secret, purchase token, or raw provider payload crosses this contract`,
      );
    }
  });
  if (document.recordType === "billingStateEvent") {
    errors.push(...eventSemantics(label, document.payload));
  }
  if (document.recordType === "webhookDeliveryAttempt") {
    errors.push(...deliverySemantics(label, document.payload));
  }
  return errors;
}

export function validateBillingStateWebhookV1Record(
  document,
  artifacts,
  label = "Webhook record",
) {
  const compiled = validators(artifacts);
  const family = Object.entries(FAMILY_RECORD_TYPES).find(([, types]) =>
    types.includes(document?.recordType),
  )?.[0];
  if (family === undefined) {
    return [`${label} declares unknown record type ${document?.recordType}`];
  }
  const validate = compiled[family];
  if (!validate(document)) return schemaErrors(label, validate.errors);
  return recordSemantics(label, document);
}

/**
 * Guards the contract itself: the public event vocabulary may never name a
 * provider. An application backend that has to branch on whether a change came
 * from Apple or Google is reading a provider integration, not a Mosaic contract.
 */
function validateEventTypeVocabulary(artifacts) {
  const provider = /apple|google|storekit|play|itunes|android|ios/i;
  const errors = [];
  for (const eventType of artifacts.eventSchema.$defs.eventType.enum) {
    if (provider.test(eventType)) {
      errors.push(
        `Webhook event type "${eventType}" names a provider; the public event vocabulary is provider-neutral`,
      );
    }
  }
  const manifest = artifacts.compatibilityManifest;
  for (const eventType of manifest.emittedEventTypes ?? []) {
    if (!manifest.eventTypes.includes(eventType)) {
      errors.push(`Webhook emits ${eventType}, which is not a declared event type`);
    }
  }
  return errors;
}

/**
 * Guards the contract itself: an event's summarized access state may never be
 * `unavailable`.
 *
 * `unavailable` says Mosaic could not answer a read. An event is not a read --
 * it exists only because a projection committed a new snapshot, so the
 * projection did answer. The worst an event can honestly say about an axis is
 * `unknown`, carrying the uncertainty that explains why. Admitting
 * `unavailable` here would put a service-delivery state on a record that is not
 * authoritative in the first place, and a tolerant consumer would have no reason
 * to distrust it.
 */
function validateSummaryAccessVocabulary(artifacts) {
  const errors = [];
  const members = artifacts.eventSchema.$defs.accessState.enum;
  if (members.includes("unavailable")) {
    errors.push(
      "Webhook stateSummary.accessState may never include unavailable: an event is not a read, so Mosaic's ability to answer is not one of its states",
    );
  }
  for (const required of ["active", "inactive", "unknown"]) {
    if (!members.includes(required)) {
      errors.push(
        `Webhook stateSummary.accessState must include ${required}, or a committed projection has nowhere honest to land`,
      );
    }
  }
  return errors;
}

/**
 * The webhook is the one contract in the protocol whose consumer tolerance is
 * `ignore` for unknown fields, event types, and enumeration members. That is
 * only safe because a consumer is never permitted to project state from the
 * payload: an event is a *notification*, and the authoritative state is the
 * Authoritative Entitlement snapshot the consumer must re-read.
 *
 * Nothing in a document can carry that rule, so the manifest states it and this
 * guard pins it. Without the pin, dropping or reworded `authoritativeState`
 * would leave three `ignore` arms standing with no counterweight, and a consumer
 * built to the manifest could quietly start believing a truncated payload.
 *
 * Documented in docs/protocol/billing-state-webhook-v1.md.
 */
const REQUIRED_CONSUMER_TOLERANCE = Object.freeze({
  authoritativeState: "reReadSnapshot",
  signatureVerification: "requiredBeforeParsing",
  duplicateEvent: "deduplicateByEventId",
  ordering: "ignoreOlderSnapshotVersion",
});

function validateAuthoritativeReReadPolicy(artifacts) {
  const errors = [];
  const tolerance = artifacts.compatibilityManifest.consumerTolerance;
  if (
    tolerance === null ||
    typeof tolerance !== "object" ||
    Array.isArray(tolerance)
  ) {
    return [
      "Webhook compatibility manifest must declare a consumerTolerance object; the ignore arms are only safe alongside the re-read requirement",
    ];
  }
  for (const [key, expected] of Object.entries(REQUIRED_CONSUMER_TOLERANCE)) {
    if (tolerance[key] !== expected) {
      errors.push(
        `Webhook consumerTolerance.${key} must be exactly "${expected}", not ${JSON.stringify(tolerance[key])}: a consumer may never project entitlement state from a webhook payload`,
      );
    }
  }
  return errors;
}

function validateCompatibility(artifacts) {
  const compiled = validators(artifacts);
  if (!compiled.manifest(artifacts.compatibilityManifest)) {
    return schemaErrors(
      "Webhook compatibility manifest",
      compiled.manifest.errors,
    );
  }
  const errors = [];
  const manifest = artifacts.compatibilityManifest;

  const declaredRecordTypes = artifacts.eventSchema.$defs.recordType.enum;
  if (
    manifest.recordTypes.length !== declaredRecordTypes.length ||
    declaredRecordTypes.some((type) => !manifest.recordTypes.includes(type))
  ) {
    errors.push("Webhook record-type set is incomplete");
  }
  const declaredEventTypes = artifacts.eventSchema.$defs.eventType.enum;
  if (
    manifest.eventTypes.length !== declaredEventTypes.length ||
    declaredEventTypes.some((type) => !manifest.eventTypes.includes(type))
  ) {
    errors.push("Webhook event-type set is incomplete");
  }

  const manifestDirectory = dirname(
    billingStateWebhookV1Paths.compatibilityManifest,
  );
  for (const path of [
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Webhook compatibility path does not exist: ${path}`);
    }
  }
  if (
    !existsSync(
      resolve(billingStateWebhookV1Root, "..", manifest.signing.signatureVectors),
    )
  ) {
    errors.push(
      `Webhook signature vectors do not exist: ${manifest.signing.signatureVectors}`,
    );
  }

  const canonical = new Set(
    manifest.canonicalFixtures.map((path) => resolve(manifestDirectory, path)),
  );
  for (const path of artifacts.validFixturePaths) {
    if (!canonical.has(path)) {
      errors.push(
        `Webhook fixture ${relative(billingStateWebhookV1Root, path)} is not listed in the compatibility manifest`,
      );
    }
  }
  const covered = new Set(
    artifacts.validFixtures.map((document) => document.recordType),
  );
  for (const recordType of declaredRecordTypes) {
    if (!covered.has(recordType)) {
      errors.push(`Webhook record type ${recordType} has no canonical fixture`);
    }
  }
  const emitted = new Set(
    artifacts.validFixtures
      .filter((document) => document.recordType === "billingStateEvent")
      .map((document) => document.payload.eventType),
  );
  for (const eventType of manifest.emittedEventTypes) {
    if (!emitted.has(eventType)) {
      errors.push(`Webhook event type ${eventType} is emitted but has no fixture`);
    }
  }
  return errors;
}

export function validateBillingStateWebhookV1Artifacts(artifacts) {
  const compiled = validators(artifacts);
  const errors = [
    ...validateEventTypeVocabulary(artifacts),
    ...validateSummaryAccessVocabulary(artifacts),
    ...validateAuthoritativeReReadPolicy(artifacts),
    ...validateCompatibility(artifacts),
  ];

  for (const [index, document] of artifacts.validFixtures.entries()) {
    const path = artifacts.validFixturePaths[index];
    const label = `Webhook fixture ${relative(billingStateWebhookV1Root, path)}`;
    const family = familyOf(path);
    if (family === undefined) {
      errors.push(`${label} is in a directory with no schema family`);
      continue;
    }
    if (!FAMILY_RECORD_TYPES[family].includes(document.recordType)) {
      errors.push(
        `${label} declares ${document.recordType}, which does not belong in this directory`,
      );
      continue;
    }
    const validate = compiled[family];
    if (!validate(document)) {
      errors.push(...schemaErrors(label, validate.errors));
      continue;
    }
    errors.push(...recordSemantics(label, document));
  }

  for (const [index, document] of artifacts.invalidFixtures.entries()) {
    const path = artifacts.invalidFixturePaths[index];
    const label = `Invalid Webhook fixture ${relative(billingStateWebhookV1Root, path)}`;
    const accepted = Object.keys(FAMILY_RECORD_TYPES).some((family) => {
      const validate = compiled[family];
      return validate(document) && recordSemantics(label, document).length === 0;
    });
    if (accepted) errors.push(`${label} was accepted`);
  }

  return errors;
}

export function validateBillingStateWebhookV1JsonFormatting() {
  const paths = [
    billingStateWebhookV1Paths.eventSchema,
    billingStateWebhookV1Paths.deliverySchema,
    billingStateWebhookV1Paths.compatibilityManifestSchema,
    billingStateWebhookV1Paths.compatibilityManifest,
    ...jsonPaths(billingStateWebhookV1Paths.fixtureDirectory),
  ];
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const canonical = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    return source === canonical
      ? []
      : [`${relative(billingStateWebhookV1Root, path)} is not canonical JSON`];
  });
}
