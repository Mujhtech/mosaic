import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import {
  loadAuthoritativeEntitlementV1Artifacts,
  validateAuthoritativeEntitlementV1Record,
} from "./authoritative-entitlement-validation-v1.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const authoritativeEntitlementV1Artifacts =
  loadAuthoritativeEntitlementV1Artifacts();
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const jsonFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith(".json") ? [path] : [];
  }).sort();

const isRecordFixture = (path) => !path.includes("/vectors/");

const specs = Object.freeze({
  authoritativeEntitlementV2: {
    schema: "schema/authoritative-entitlement/v2/contract.schema.json",
    manifestSchema: "schema/authoritative-entitlement/v2/compatibility-manifest.schema.json",
    manifest: "compatibility/authoritative-entitlement/v2.json",
    fixtures: "fixtures/authoritative-entitlement/v2",
    dependencies: ["schema/authoritative-entitlement/v1/snapshot.schema.json"],
  },
  billingMigrationOperationsV1: {
    schema: "schema/billing-migration-operations/v1/contract.schema.json",
    manifestSchema: "schema/billing-migration-operations/v1/compatibility-manifest.schema.json",
    manifest: "compatibility/billing-migration-operations/v1.json",
    fixtures: "fixtures/billing-migration-operations/v1",
    dependencies: [],
  },
  billingStateWebhookV2: {
    schema: "schema/billing-state-webhook/v2/contract.schema.json",
    manifestSchema: "schema/billing-state-webhook/v2/compatibility-manifest.schema.json",
    manifest: "compatibility/billing-state-webhook/v2.json",
    fixtures: "fixtures/billing-state-webhook/v2",
    dependencies: ["schema/billing-state-webhook/v1/event.schema.json", "schema/billing-state-webhook/v1/delivery.schema.json"],
  },
});

export function canonicalSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialization).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialization(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function authorityDigest(authority, snapshot) {
  return `sha256:${createHash("sha256").update(canonicalSerialization({ authority, snapshot }), "utf8").digest("hex")}`;
}

export function authorityCacheDecision(current, candidate) {
  if (candidate.authorityEpoch < current.authorityEpoch) return "reject_older_authority_epoch";
  if (candidate.authorityEpoch > current.authorityEpoch) return "replace_for_newer_authority_epoch";
  if (candidate.snapshotVersion <= current.snapshotVersion) return "reject_snapshot_not_newer";
  return "replace_for_newer_snapshot";
}

export function validateUnchangedAgainstCachedSnapshot(unchangedRecord, cachedRecord) {
  const errors = [];
  const confirmation = unchangedRecord.payload.unchanged;
  const cached = cachedRecord.payload.snapshot;
  if (canonicalSerialization(unchangedRecord.payload.authority) !== canonicalSerialization(cachedRecord.payload.authority)) errors.push("unchanged authority differs from retained cached authority");
  if (unchangedRecord.payload.snapshotAuthorityDigest !== cachedRecord.payload.snapshotAuthorityDigest) errors.push("unchanged digest does not identify the retained cached snapshot");
  for (const field of ["billingCustomerId", "projectId", "environmentId", "snapshotVersion", "entityTag", "asOf"]) {
    if (confirmation[field] !== cached[field]) errors.push(`unchanged ${field} differs from retained cached snapshot`);
  }
  if (canonicalSerialization(confirmation.projectionStatus) !== canonicalSerialization(cached.projectionStatus)) errors.push("unchanged projectionStatus differs from retained cached snapshot");
  if (Date.parse(confirmation.issuedAt) < Date.parse(cached.issuedAt)) errors.push("unchanged confirmation predates retained cached snapshot");
  if (Date.parse(confirmation.refreshAfter) < Date.parse(cached.refreshAfter) || Date.parse(confirmation.validUntil) < Date.parse(cached.validUntil)) errors.push("unchanged confirmation regresses the retained freshness window");
  return errors;
}

export function entitlementSyncResponseDecision(syncRequest, currentSnapshot) {
  const knownDigest = syncRequest.payload.knownSnapshotAuthorityDigest;
  if (knownDigest === undefined || knownDigest !== currentSnapshot.payload.snapshotAuthorityDigest) return "full_snapshot";
  if (syncRequest.payload.request.applicationId !== currentSnapshot.payload.authority.scope.applicationId ||
      syncRequest.payload.request.platform !== currentSnapshot.payload.authority.scope.platform) return "full_snapshot";
  if (syncRequest.payload.knownAuthorityEpoch !== currentSnapshot.payload.authority.authorityEpoch ||
      syncRequest.payload.knownSnapshotVersion !== currentSnapshot.payload.snapshot.snapshotVersion) return "full_snapshot";
  return "snapshot_unchanged";
}

export function loadPhase9CArtifacts(name) {
  const spec = specs[name];
  const fixturePaths = jsonFiles(resolve(root, spec.fixtures));
  return {
    name, spec, schema: read(resolve(root, spec.schema)), manifestSchema: read(resolve(root, spec.manifestSchema)),
    manifest: read(resolve(root, spec.manifest)), dependencies: spec.dependencies.map((path) => read(resolve(root, path))),
    fixturePaths, validFixturePaths: fixturePaths.filter((path) => !path.includes("/invalid/") && isRecordFixture(path)),
    invalidFixturePaths: fixturePaths.filter((path) => path.includes("/invalid/")),
  };
}

const authorityCommandDigestKeys = Object.freeze({
  cutover: ["applicationVersionDigest", "approvalDigest", "evidenceDigest", "finalWatermarkDigest", "manifestDigest", "mappingDigest", "policyDigest", "readinessDigest", "scopeDigest"],
  rollback: ["approvalDigest", "authorityDigest", "checkpointDigest", "rollbackPrerequisitesDigest"],
});

export function commandPreconditionDecision(vector) {
  const required = authorityCommandDigestKeys[vector.command];
  if (!required) return "reject_unknown_command";
  const supplied = Object.keys(vector.expectedDigests).sort();
  if (JSON.stringify(supplied) !== JSON.stringify(required)) return "reject_invalid_digest_set";
  if (vector.expectedStateVersion !== vector.actualStateVersion) return "reject_stale_state";
  if (Date.parse(vector.commandAt) > Date.parse(vector.approvalExpiresAt)) return "reject_expired_approval";
  for (const [name, digest] of Object.entries(vector.expectedDigests)) {
    if (vector.actualDigests[name] !== digest) return "reject_stale_digest";
  }
  return "accept";
}

export function sourcePullConditionDecision(vector) {
  if (vector.intent === "snapshot" && vector.hasStartingPosition) return "reject_unexpected_starting_position";
  if (["delta", "final_delta"].includes(vector.intent) && !vector.hasStartingPosition) return "reject_missing_starting_position";
  if (vector.status === "completed" && !vector.hasResult) return "reject_missing_result";
  if (vector.status !== "completed" && vector.hasResult) return "reject_unexpected_result";
  const finalDeltaEvaluationExpected = vector.intent === "final_delta" && vector.status === "completed" && vector.providerValidationImportStatus === "completed";
  if (finalDeltaEvaluationExpected && !vector.hasFinalDeltaEvaluation) return "reject_missing_final_delta_evaluation";
  if (!finalDeltaEvaluationExpected && vector.hasFinalDeltaEvaluation) return "reject_unexpected_final_delta_evaluation";
  return "accept";
}

export function completionTimingDecision(vector) {
  if (Date.parse(vector.completedAt) < Date.parse(vector.stabilizationEndedAt) || Date.parse(vector.completedAt) < Date.parse(vector.rollbackWindowEndedAt)) return "reject_completion_before_windows_end";
  if (Date.parse(vector.credentialRemovedAt) < Date.parse(vector.rollbackWindowEndedAt)) return "reject_credential_before_rollback_end";
  if (vector.legalHold) return vector.sourceObjectsDeleteAt === undefined ? "accept" : "reject_legal_hold_has_deletion_schedule";
  if (Date.parse(vector.sourceObjectsDeleteAt) - Date.parse(vector.completedAt) !== 30 * 24 * 60 * 60 * 1000) return "reject_source_deletion_not_thirty_days";
  return "accept";
}

function validators(artifacts) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  for (const schema of [...artifacts.dependencies, artifacts.schema, artifacts.manifestSchema]) ajv.addSchema(schema);
  return { record: ajv.getSchema(artifacts.schema.$id), manifest: ajv.getSchema(artifacts.manifestSchema.$id) };
}

function semanticErrors(name, document) {
  const p = document.payload;
  const errors = [];
  if (name === "authoritativeEntitlementV2" && document.recordType === "customerEntitlementSnapshot") {
    errors.push(
      ...validateAuthoritativeEntitlementV1Record(
        {
          authoritativeEntitlementContractVersion: "1",
          recordType: "customerEntitlementSnapshot",
          payload: p.snapshot,
        },
        authoritativeEntitlementV1Artifacts,
      ).map((error) => `embedded v1 snapshot: ${error}`),
    );
    if (p.snapshotAuthorityDigest !== authorityDigest(p.authority, p.snapshot)) errors.push("snapshotAuthorityDigest does not bind authority and snapshot");
    if (p.authority.scope.projectId !== p.snapshot.projectId || p.authority.scope.environmentId !== p.snapshot.environmentId) errors.push("authority scope does not match snapshot Project and Environment");
  }
  if (name === "authoritativeEntitlementV2" && document.recordType === "snapshotUnchanged") {
    errors.push(
      ...validateAuthoritativeEntitlementV1Record(
        { authoritativeEntitlementContractVersion: "1", recordType: "snapshotUnchanged", payload: p.unchanged },
        authoritativeEntitlementV1Artifacts,
      ).map((error) => `embedded v1 unchanged response: ${error}`),
    );
    if (p.authority.scope.projectId !== p.unchanged.projectId || p.authority.scope.environmentId !== p.unchanged.environmentId) errors.push("authority scope does not match unchanged Project and Environment");
  }
  if (name === "billingMigrationOperationsV1") {
    if (document.recordType === "reconciliationCase" && p.sourceAccessException) {
      if (p.sourceAccessException.proposerActorId === p.sourceAccessException.approverActorId) errors.push("source-access exception proposer and approver must be distinct humans");
      if (Date.parse(p.sourceAccessException.expiresAt) <= Date.parse(p.sourceAccessException.approvedAt)) errors.push("source-access exception must expire after approval");
    }
    if (document.recordType === "readinessAssessment" && p.ready && (p.currentAccessMappingPercent !== 100 || p.currentAccessEvidencePercent !== 100 || p.unresolved.critical !== 0 || p.unresolved.blocking !== 0 || !p.finalDeltaCompleted || !p.watermarksFresh || !p.supportedVersionsAuthorityAware)) errors.push("ready does not satisfy the frozen production readiness gate");
    if (document.recordType === "importBatch" && p.validatedCount + p.quarantinedCount > p.recordCount) errors.push("import outcomes exceed the batch record count");
    if (document.recordType === "sourcePullJob") {
      if (p.startedAt && Date.parse(p.startedAt) < Date.parse(p.requestedAt)) errors.push("source pull started before it was requested");
      if (p.completedAt && Date.parse(p.completedAt) < Date.parse(p.startedAt)) errors.push("source pull completed before it started");
      if (p.failedAt && Date.parse(p.failedAt) < Date.parse(p.startedAt)) errors.push("source pull failed before it started");
    }
    if (document.recordType === "completionReport") {
      const decision = completionTimingDecision(p);
      if (decision !== "accept") errors.push(`completion timing rejected: ${decision}`);
    }
  }
  if (name === "billingStateWebhookV2" && document.recordType === "billingStateEvent") {
    if (Date.parse(p.createdAt) < Date.parse(p.occurredAt)) errors.push("event was created before it occurred");
    if (p.eventType.startsWith("authority.") && p.changedEntitlements.length !== 0) errors.push("authority transition event must not imply an entitlement-state delta");
    if (p.eventType === "customer.entitlements.changed" && !p.changedEntitlements.some((entry) => entry.previousState !== entry.currentState)) errors.push("entitlement event reports no state change");
  }
  return errors;
}

export function validatePhase9CArtifacts(artifacts) {
  const errors = [];
  const validate = validators(artifacts);
  if (!validate.manifest(artifacts.manifest)) errors.push(...validate.manifest.errors.map((e) => `manifest${e.instancePath} ${e.message}`));
  const manifestPaths = new Set(artifacts.manifest.canonicalFixtures.map((path) => resolve(root, path.replace(/^\.\.\/\.\.\//, ""))));
  for (const path of artifacts.validFixturePaths) {
    const document = read(path);
    if (!validate.record(document)) errors.push(...validate.record.errors.map((e) => `${path}${e.instancePath} ${e.message}`));
    errors.push(...semanticErrors(artifacts.name, document).map((e) => `${path}: ${e}`));
    if (!manifestPaths.has(path)) errors.push(`${path}: valid fixture is absent from canonicalFixtures`);
  }
  for (const path of artifacts.invalidFixturePaths) {
    const document = read(path);
    const schemaValid = validate.record(document);
    if (schemaValid && semanticErrors(artifacts.name, document).length === 0) errors.push(`${path}: invalid fixture was accepted`);
  }
  if (artifacts.name === "authoritativeEntitlementV2") {
    const fullSnapshots = artifacts.validFixturePaths
      .map((path) => read(path))
      .filter((document) => document.recordType === "customerEntitlementSnapshot");
    const unchangedRecords = artifacts.validFixturePaths
      .map((path) => read(path))
      .filter((document) => document.recordType === "snapshotUnchanged");
    for (const unchanged of unchangedRecords) {
      const cached = fullSnapshots.find((candidate) =>
        candidate.payload.snapshotAuthorityDigest === unchanged.payload.snapshotAuthorityDigest,
      );
      if (!cached) {
        errors.push(`snapshotUnchanged ${unchanged.payload.snapshotAuthorityDigest} has no canonical retained snapshot`);
        continue;
      }
      errors.push(...validateUnchangedAgainstCachedSnapshot(unchanged, cached));
    }
  }
  return errors;
}

export function validatePhase9CJsonFormatting() {
  const errors = [];
  for (const name of Object.keys(specs)) {
    const artifacts = loadPhase9CArtifacts(name);
    for (const path of [resolve(root, artifacts.spec.schema), resolve(root, artifacts.spec.manifestSchema), resolve(root, artifacts.spec.manifest), ...artifacts.fixturePaths]) {
      const source = readFileSync(path, "utf8");
      const expected = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
      if (source !== expected) errors.push(`${path}: JSON is not canonical two-space formatting`);
    }
  }
  return errors;
}
