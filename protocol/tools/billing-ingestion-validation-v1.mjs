/**
 * Billing Ingestion Contract v1 validation.
 *
 * The contract is four canonical schemas plus a compatibility manifest. Each
 * schema is a self-describing envelope: `billingIngestionContractVersion`,
 * `recordType`, and a `payload` dispatched by record type. A fixture's
 * directory therefore determines which schema it is a document of, and a
 * fixture in the wrong directory is a defect rather than a curiosity.
 *
 * The semantic layer here is deliberately small. Most of this contract's frozen
 * rules -- no `validated` submission status, no client-authoritative fact, no
 * unclassified Store Environment on a fact, quarantine never yields a fact,
 * transient always means retryable -- are expressible in JSON Schema and are
 * expressed there, so `rejection-layers.json` records them as `"schema"`. What
 * remains here is what JSON Schema cannot state: cross-field time ordering,
 * retry arithmetic, record size, manifest reconciliation, and two guards that
 * watch the contract itself rather than a document (no submission status may
 * ever be named `validated`, and no billing record may name entitlement,
 * subscription, customer, or access-grant vocabulary).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const billingIngestionV1Root = resolve(toolsDirectory, "..");

export const billingIngestionV1Paths = Object.freeze({
  observationSchema: resolve(
    billingIngestionV1Root,
    "schema/billing-ingestion/v1/observation.schema.json",
  ),
  submissionResponseSchema: resolve(
    billingIngestionV1Root,
    "schema/billing-ingestion/v1/submission-response.schema.json",
  ),
  validationSchema: resolve(
    billingIngestionV1Root,
    "schema/billing-ingestion/v1/validation.schema.json",
  ),
  transactionFactSchema: resolve(
    billingIngestionV1Root,
    "schema/billing-ingestion/v1/transaction-fact.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    billingIngestionV1Root,
    "schema/billing-ingestion/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    billingIngestionV1Root,
    "compatibility/billing-ingestion/v1.json",
  ),
  fixtureDirectory: resolve(
    billingIngestionV1Root,
    "fixtures/billing-ingestion/v1",
  ),
});

/** Fixture directory to the schema its documents belong to. */
const FIXTURE_FAMILIES = Object.freeze({
  "": "observation",
  responses: "submissionResponse",
  validation: "validation",
  "transaction-facts": "transactionFact",
});

/** Record types each schema accepts, used to catch misfiled fixtures. */
const FAMILY_RECORD_TYPES = Object.freeze({
  observation: ["clientTransactionObservation", "serverTransactionObservation"],
  submissionResponse: ["observationSubmissionResult"],
  validation: ["validationResult", "productResolution", "quarantineRecord"],
  transactionFact: ["transactionFact"],
});

export function readBillingIngestionV1Json(filePath) {
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

/** The fixture's family, derived from its directory under the fixture root. */
function familyOf(path) {
  const directory = dirname(relative(billingIngestionV1Paths.fixtureDirectory, path));
  return FIXTURE_FAMILIES[directory === "." ? "" : directory];
}

export function loadBillingIngestionV1Artifacts() {
  const fixturePaths = jsonPaths(billingIngestionV1Paths.fixtureDirectory);
  const validFixturePaths = fixturePaths.filter(
    (path) => !path.includes("/invalid/"),
  );
  const invalidFixturePaths = fixturePaths.filter((path) =>
    path.includes("/invalid/"),
  );
  return {
    observationSchema: readBillingIngestionV1Json(
      billingIngestionV1Paths.observationSchema,
    ),
    submissionResponseSchema: readBillingIngestionV1Json(
      billingIngestionV1Paths.submissionResponseSchema,
    ),
    validationSchema: readBillingIngestionV1Json(
      billingIngestionV1Paths.validationSchema,
    ),
    transactionFactSchema: readBillingIngestionV1Json(
      billingIngestionV1Paths.transactionFactSchema,
    ),
    compatibilityManifestSchema: readBillingIngestionV1Json(
      billingIngestionV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readBillingIngestionV1Json(
      billingIngestionV1Paths.compatibilityManifest,
    ),
    fixturePaths,
    validFixturePaths,
    invalidFixturePaths,
    validFixtures: validFixturePaths.map(readBillingIngestionV1Json),
    invalidFixtures: invalidFixturePaths.map(readBillingIngestionV1Json),
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
    artifacts.observationSchema,
    artifacts.transactionFactSchema,
    artifacts.submissionResponseSchema,
    artifacts.validationSchema,
    artifacts.compatibilityManifestSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return {
    observation: ajv.getSchema(artifacts.observationSchema.$id),
    submissionResponse: ajv.getSchema(artifacts.submissionResponseSchema.$id),
    validation: ajv.getSchema(artifacts.validationSchema.$id),
    transactionFact: ajv.getSchema(artifacts.transactionFactSchema.$id),
    manifest: ajv.getSchema(artifacts.compatibilityManifestSchema.$id),
  };
}

function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) {
    return `${at}.${offending} is not allowed`;
  }
  return `${at} ${error.message ?? "is invalid"}`;
}

function schemaErrors(label, errors = []) {
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [...new Set(reported.map((error) => describeSchemaError(label, error)))];
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function before(earlier, later) {
  return Date.parse(earlier) <= Date.parse(later);
}

/**
 * Vocabulary Phase 9A forbids on every new billing surface. A billing record
 * records what a provider confirmed; it never describes a customer's access.
 * Checked as a substring of property names so `entitlementActive`,
 * `subscriptionState`, and `accessGrantId` are all caught.
 */
const FORBIDDEN_FIELD_VOCABULARY = Object.freeze([
  "entitlement",
  "subscriber",
  "subscription",
  "customer",
  "accessgrant",
]);

/**
 * A JWS/receipt/purchase-token shape. Nothing in this contract may carry one,
 * and no fixture may contain one even as a placeholder: the fixtures are the
 * examples SDK authors copy.
 */
const JWS_SHAPE = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;

function walkStrings(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}/${index}`, visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(key, `${path}/${key}`, true);
      walkStrings(child, `${path}/${key}`, visit);
    }
  }
}

function recordSemantics(label, document) {
  const errors = [];
  if (encodedBytes(document) > 32_768) {
    errors.push(`${label} exceeds the 32 KiB record limit`);
  }

  walkStrings(document, "", (value, path, isKey) => {
    if (isKey) {
      const lowered = value.toLowerCase();
      for (const banned of FORBIDDEN_FIELD_VOCABULARY) {
        if (lowered.includes(banned)) {
          errors.push(`${label}${path} uses forbidden billing vocabulary "${value}"`);
        }
      }
      return;
    }
    if (JWS_SHAPE.test(value)) {
      errors.push(`${label}${path} carries a signed-payload-shaped value`);
    }
  });

  const payload = document.payload;

  // A trusted server observation may carry the full Google Play purchase token.
  // When it does, the token and the reference must be the same fact stated two
  // ways: the reference is the token's digest. A mismatch means the record
  // would validate one purchase and be filed under another, which no schema
  // rule can catch.
  if (document.recordType === "serverTransactionObservation" && payload?.purchaseToken) {
    const expected = createHash("sha256")
      .update(payload.purchaseToken, "utf8")
      .digest("hex");
    if (payload.transactionReference?.value !== expected) {
      errors.push(
        `${label} purchaseToken does not digest to its transactionReference; ` +
          "the reference must be SHA-256 over the UTF-8 token in lowercase hexadecimal",
      );
    }
  }

  const facts = [];
  if (document.recordType === "transactionFact") facts.push(payload);
  if (document.recordType === "validationResult" && payload?.transactionFact) {
    facts.push(payload.transactionFact);
  }
  for (const fact of facts) {
    if (fact.occurredAt && fact.recordedAt && !before(fact.occurredAt, fact.recordedAt)) {
      errors.push(
        `${label} transaction fact ${fact.transactionFactId} was recorded before it occurred`,
      );
    }
    if (fact.periodStart && fact.periodEnd && !before(fact.periodStart, fact.periodEnd)) {
      errors.push(
        `${label} transaction fact ${fact.transactionFactId} ends its service period before it starts`,
      );
    }
    if (
      fact.revocation?.revokedAt &&
      fact.occurredAt &&
      !before(fact.occurredAt, fact.revocation.revokedAt)
    ) {
      errors.push(
        `${label} transaction fact ${fact.transactionFactId} was revoked before it occurred`,
      );
    }
    if (fact.replay && fact.replay.originalValidationId === payload.validationId) {
      errors.push(
        `${label} transaction fact ${fact.transactionFactId} replays its own validation`,
      );
    }
  }

  if (document.recordType === "validationResult") {
    const retry = payload?.retry;
    if (retry !== undefined) {
      if (retry.attempt > retry.maxAttempts) {
        errors.push(`${label} retry attempt exceeds maxAttempts`);
      }
      if (retry.exhausted !== retry.attempt >= retry.maxAttempts) {
        errors.push(
          `${label} retry exhaustion contradicts its attempt count; exhaustion must become a permanent failure, never a validated or quarantined outcome`,
        );
      }
    }
    if (payload?.replay?.originalValidationId === payload.validationId) {
      errors.push(`${label} replays its own validation`);
    }
  }

  return errors;
}

export function validateBillingIngestionV1Record(document, artifacts, label = "Billing record") {
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
 * Guards the contract itself, not a document: the submission-result status set
 * may never gain a member that reads as a validation claim. Acceptance means
 * "queued"; a reader that sees `validated` here would grant access on intake.
 */
function validateSubmissionStatusVocabulary(artifacts) {
  const banned = /^(validated|verified|confirmed|entitled)$/;
  const errors = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (typeof node.const === "string" && banned.test(node.const)) {
      errors.push(
        `Billing submission-result vocabulary must never contain a status named "${node.const}"`,
      );
    }
    for (const member of node.enum ?? []) {
      if (typeof member === "string" && banned.test(member)) {
        errors.push(
          `Billing submission-result vocabulary must never contain a status named "${member}"`,
        );
      }
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(artifacts.submissionResponseSchema);
  return errors;
}

function validateCompatibility(artifacts) {
  const compiled = validators(artifacts);
  if (!compiled.manifest(artifacts.compatibilityManifest)) {
    return schemaErrors("Billing compatibility manifest", compiled.manifest.errors);
  }
  const errors = [];
  const manifest = artifacts.compatibilityManifest;
  const declared = artifacts.observationSchema.$defs.recordType.enum;
  const listed = manifest.recordTypes;
  if (
    listed.length !== declared.length ||
    declared.some((recordType) => !listed.includes(recordType))
  ) {
    errors.push("Billing compatibility record-type set is incomplete");
  }
  const dispatched = Object.values(FAMILY_RECORD_TYPES).flat();
  for (const recordType of declared) {
    if (!dispatched.includes(recordType)) {
      errors.push(`Billing record type ${recordType} has no schema that dispatches it`);
    }
  }

  const manifestDirectory = dirname(billingIngestionV1Paths.compatibilityManifest);
  for (const path of [
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Billing compatibility path does not exist: ${path}`);
    }
  }

  const canonical = new Set(
    manifest.canonicalFixtures.map((path) =>
      resolve(manifestDirectory, path),
    ),
  );
  for (const path of artifacts.validFixturePaths) {
    if (!canonical.has(path)) {
      errors.push(
        `Billing fixture ${relative(billingIngestionV1Root, path)} is not listed in the compatibility manifest`,
      );
    }
  }
  const covered = new Set(
    artifacts.validFixtures.map((document) => document.recordType),
  );
  for (const recordType of declared) {
    if (!covered.has(recordType)) {
      errors.push(`Billing record type ${recordType} has no canonical fixture`);
    }
  }
  return errors;
}

export function validateBillingIngestionV1Artifacts(artifacts) {
  const compiled = validators(artifacts);
  const errors = [
    ...validateSubmissionStatusVocabulary(artifacts),
    ...validateCompatibility(artifacts),
  ];

  for (const [index, document] of artifacts.validFixtures.entries()) {
    const path = artifacts.validFixturePaths[index];
    const label = `Billing fixture ${relative(billingIngestionV1Root, path)}`;
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
    const label = `Invalid Billing fixture ${relative(billingIngestionV1Root, path)}`;
    const accepted = Object.keys(FAMILY_RECORD_TYPES).some((family) => {
      const validate = compiled[family];
      return validate(document) && recordSemantics(label, document).length === 0;
    });
    if (accepted) errors.push(`${label} was accepted`);
  }

  return errors;
}

export function validateBillingIngestionV1JsonFormatting() {
  const paths = [
    billingIngestionV1Paths.observationSchema,
    billingIngestionV1Paths.submissionResponseSchema,
    billingIngestionV1Paths.validationSchema,
    billingIngestionV1Paths.transactionFactSchema,
    billingIngestionV1Paths.compatibilityManifestSchema,
    billingIngestionV1Paths.compatibilityManifest,
    ...jsonPaths(billingIngestionV1Paths.fixtureDirectory),
  ];
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const canonical = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    return source === canonical
      ? []
      : [`${relative(billingIngestionV1Root, path)} is not canonical JSON`];
  });
}
