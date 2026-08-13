import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorityCacheDecision, commandPreconditionDecision, completionTimingDecision, entitlementSyncResponseDecision, loadPhase9CArtifacts, sourcePullConditionDecision, validatePhase9CArtifacts, validateUnchangedAgainstCachedSnapshot } from "./phase9c-contract-validation.mjs";

const fixture = (artifacts, suffix) =>
  JSON.parse(
    readFileSync(
      artifacts.fixturePaths.find((path) => path.endsWith(suffix)),
      "utf8",
    ),
  );

for (const name of ["authoritativeEntitlementV2", "billingMigrationOperationsV1", "billingStateWebhookV2"]) {
  test(`${name} schemas, manifests, and positive/negative fixtures validate`, () => {
    assert.deepEqual(validatePhase9CArtifacts(loadPhase9CArtifacts(name)), []);
  });
}

test("webhook v2 consumer tolerance is pinned to the re-read requirement", () => {
  const artifacts = loadPhase9CArtifacts("billingStateWebhookV2");
  // The tolerant arms exist only because the consumer re-reads authoritative
  // state. Pin both the manifest text and the validator that enforces it.
  assert.equal(artifacts.manifest.consumerPolicy.unknownField, "ignore");
  assert.equal(artifacts.manifest.consumerPolicy.unknownEventType, "ignore");
  assert.equal(artifacts.manifest.consumerPolicy.unknownEnumeration, "ignore");
  assert.equal(
    artifacts.manifest.consumerPolicy.authoritativeState,
    "reReadAuthoritativeEntitlementV2",
  );

  for (const mutate of [
    (manifest) => delete manifest.consumerPolicy.authoritativeState,
    (manifest) => {
      manifest.consumerPolicy.authoritativeState = "projectFromEvent";
    },
    (manifest) => delete manifest.consumerPolicy,
  ]) {
    const broken = { ...artifacts, manifest: structuredClone(artifacts.manifest) };
    mutate(broken.manifest);
    const errors = validatePhase9CArtifacts(broken);
    assert.ok(
      errors.some((error) => error.includes("consumerPolicy")),
      `expected a consumerPolicy error, got: ${errors.join("; ")}`,
    );
  }
});

test("authority epoch outranks snapshot version", () => {
  assert.equal(authorityCacheDecision({ authorityEpoch: 5, snapshotVersion: 10 }, { authorityEpoch: 4, snapshotVersion: 999 }), "reject_older_authority_epoch");
  assert.equal(authorityCacheDecision({ authorityEpoch: 5, snapshotVersion: 999 }, { authorityEpoch: 6, snapshotVersion: 1 }), "replace_for_newer_authority_epoch");
});

test("legacy and unsupported authority remains unavailable, never inactive", () => {
  const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
  const fixture = JSON.parse(readFileSync(artifacts.validFixturePaths.find((path) => path.endsWith("authority-unavailable.json")), "utf8"));
  assert.equal(fixture.payload.result, "unavailable");
  assert.equal(fixture.payload.reason, "authority_unknown");
  assert.equal(JSON.stringify(fixture).includes("inactive"), false);
});

test("missing frozen support policy fails closed without placeholder minimum support", () => {
  const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
  const unavailable = fixture(artifacts, "authority-policy-unavailable.json");
  assert.equal(unavailable.payload.result, "unavailable");
  assert.equal(unavailable.payload.reason, "policy_unavailable");
  assert.equal(unavailable.payload.minimumSupport, undefined);
  assert.equal(JSON.stringify(unavailable).includes("inactive"), false);
  assert.equal(artifacts.manifest.readerPolicy.policyUnavailable, "omitMinimumSupportFailClosedNeverInferAuthority");

  for (const path of artifacts.validFixturePaths) {
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.recordType === "authorityUnavailable" && record.payload.reason === "policy_unavailable") continue;
    if (["authorityUnavailable", "customerEntitlementSnapshot", "snapshotUnchanged"].includes(record.recordType)) {
      assert.ok(record.payload.minimumSupport, path);
    }
  }
});

test("sync requests never author customer or tenant scope", () => {
  const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
  for (const path of artifacts.validFixturePaths.filter((candidate) => candidate.endsWith("sync-request.json"))) {
    const payload = JSON.parse(readFileSync(path, "utf8")).payload;
    for (const field of ["projectId", "environmentId", "billingCustomerId"]) assert.equal(payload[field], undefined, `${path} authors ${field}`);
  }
  assert.equal(artifacts.manifest.readerPolicy.requestScopeAuthority, "deriveFromOpaqueCATAndSdkAuthentication");
});

test("known snapshot authority digest only verifies unchanged eligibility", () => {
  const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
  const request = fixture(artifacts, "/sync-request.json");
  const current = fixture(artifacts, "ios-full-snapshot.json");
  assert.equal(entitlementSyncResponseDecision(request, current), "snapshot_unchanged");

  for (const mutation of [
    (candidate) => { delete candidate.payload.knownSnapshotAuthorityDigest; },
    (candidate) => { candidate.payload.knownSnapshotAuthorityDigest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; },
    (candidate) => { candidate.payload.knownAuthorityEpoch -= 1; },
    (candidate) => { candidate.payload.knownSnapshotVersion -= 1; },
    (candidate) => { candidate.payload.request.applicationId = "fixture-application-other"; },
    (candidate) => { candidate.payload.request.platform = "android"; },
  ]) {
    const candidate = structuredClone(request);
    mutation(candidate);
    assert.equal(entitlementSyncResponseDecision(candidate, current), "full_snapshot");
  }

  assert.equal(artifacts.manifest.readerPolicy.knownSnapshotAuthorityDigest, "optionalVerificationInputNeverSelector");
  assert.equal(artifacts.manifest.readerPolicy.unchangedEligibility, "exactDigestScopeEpochAndSnapshotMatch");
});

test("iOS and Android each have request, full snapshot, and freshness-sliding unchanged vectors", () => {
  const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
  for (const platform of ["ios", "android"]) {
    const request = fixture(artifacts, platform === "ios" ? "/sync-request.json" : "android-sync-request.json");
    const full = fixture(artifacts, `${platform}-full-snapshot.json`);
    const unchanged = fixture(artifacts, platform === "ios" ? "/snapshot-unchanged.json" : "android-snapshot-unchanged.json");
    assert.equal(request.payload.request.platform, platform);
    assert.equal(full.payload.authority.scope.platform, platform);
    assert.equal(unchanged.payload.authority.scope.platform, platform);
    assert.equal(request.payload.request.applicationId, full.payload.authority.scope.applicationId);
    assert.equal(full.payload.authority.scope.applicationId, unchanged.payload.authority.scope.applicationId);
    assert.deepEqual(validateUnchangedAgainstCachedSnapshot(unchanged, full), []);
    assert.ok(Date.parse(unchanged.payload.unchanged.refreshAfter) >= Date.parse(full.payload.snapshot.refreshAfter));
    assert.ok(Date.parse(unchanged.payload.unchanged.validUntil) >= Date.parse(full.payload.snapshot.validUntil));

    for (const mutation of [
      (record) => { record.payload.unchanged.billingCustomerId = "fixture-customer-other"; },
      (record) => { record.payload.unchanged.snapshotVersion += 1; },
      (record) => { record.payload.unchanged.entityTag = "cs-other-v4"; },
      (record) => { record.payload.snapshotAuthorityDigest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; },
      (record) => { record.payload.authority.scope.applicationId = "fixture-application-other"; },
      (record) => { record.payload.unchanged.refreshAfter = "2026-07-28T12:30:00.000Z"; },
    ]) {
      const broken = structuredClone(unchanged);
      mutation(broken);
      assert.notDeepEqual(validateUnchangedAgainstCachedSnapshot(broken, full), []);
    }
  }
  assert.deepEqual(artifacts.manifest.conformancePlatforms, ["ios", "android"]);
});

test("migration policy forbids heuristic identity, arbitrary repairs, and implicit wildcard scope", () => {
  const manifest = loadPhase9CArtifacts("billingMigrationOperationsV1").manifest;
  assert.equal(manifest.policy.identityMatching, "exactOrAuditedAliasOnly");
  assert.equal(manifest.policy.arbitraryRepair, "forbidden");
  assert.equal(manifest.policy.scopeWildcard, "forbidden");
});

test("migration approvals defer environment-specific separation to the server", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const selfApproved = fixture(artifacts, "approval-nonproduction-self-approved.json");
  assert.equal(selfApproved.payload.proposerActorId, selfApproved.payload.approverActorId);
  assert.deepEqual(validatePhase9CArtifacts(artifacts), []);
  assert.equal(artifacts.manifest.policy.productionApprovals, "twoDistinctHumans");
  assert.equal(artifacts.manifest.policy.nonProductionApprovals, "oneAuthorizedOperatorMaySelfApprove");
  assert.equal(artifacts.manifest.policy.approvalEnvironmentAuthority, "serverDerivedFromProgram");
});

test("source-access exceptions always require distinct humans", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const valid = fixture(artifacts, "source-access-exception-case.json");
  const invalid = fixture(artifacts, "invalid/same-person-source-access-exception.json");
  assert.notEqual(valid.payload.sourceAccessException.proposerActorId, valid.payload.sourceAccessException.approverActorId);
  assert.equal(invalid.payload.sourceAccessException.proposerActorId, invalid.payload.sourceAccessException.approverActorId);
  assert.deepEqual(validatePhase9CArtifacts(artifacts), []);
});

test("source identifiers preserve RevenueCat anonymous IDs without widening Mosaic IDs", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const mapping = fixture(artifacts, "mapping-set.json");
  assert.ok(
    mapping.payload.entries.some((entry) =>
      entry.sourceIdentifier.startsWith("$RCAnonymousID:"),
    ),
  );
  assert.doesNotMatch("$RCAnonymousID:fixture", new RegExp(artifacts.schema.$defs.id.pattern));
  assert.match("$RCAnonymousID:fixture", new RegExp(artifacts.schema.$defs.sourceIdentifier.pattern));
  assert.equal(artifacts.schema.$defs.sourceIdentifier.maxLength, 512);
});

test("migration commands reject stale state and digest preconditions", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const vectorPath = artifacts.fixturePaths.find((path) => path.endsWith("vectors/command-preconditions.json"));
  const vectors = JSON.parse(readFileSync(vectorPath, "utf8")).vectors;
  for (const vector of vectors) {
    assert.equal(commandPreconditionDecision(vector), vector.decision, vector.id);
  }
});

test("source pulls bind intent, durable job results, and automatic final-delta evaluation", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const vectors = fixture(artifacts, "vectors/source-pull-conditions.json").vectors;
  for (const vector of vectors) assert.equal(sourcePullConditionDecision(vector), vector.decision, vector.id);

  const finalDelta = fixture(artifacts, "source-pull-final-delta-completed.json").payload;
  assert.equal(finalDelta.command, "sourcePull");
  assert.equal(finalDelta.intent, "final_delta");
  assert.ok(finalDelta.result.finalDeltaEvaluation.reference);
  const awaitingImport = fixture(artifacts, "source-pull-final-delta-import-pending.json").payload;
  assert.equal(awaitingImport.result.providerValidationImport.status, "pending");
  assert.equal(awaitingImport.result.finalDeltaEvaluation, undefined);
  assert.deepEqual(artifacts.schema.$defs.sourcePullJob.properties.intent.enum, ["snapshot", "delta", "final_delta"]);
  assert.deepEqual(artifacts.schema.$defs.sourcePullJob.properties.status.enum, ["pending", "running", "completed", "failed"]);
  assert.ok(!artifacts.schema.properties.recordType.enum.includes("finalDeltaCommand"));
  assert.equal(artifacts.manifest.policy.finalDeltaEvaluation, "automaticallyQueuedAfterProviderValidationImportSettles");
  assert.equal(artifacts.manifest.policy.separateFinalDeltaCommand, "forbidden");
});

test("operator capabilities are a closed affordance-only vocabulary", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const capabilities = fixture(artifacts, "operator-capabilities.json").payload.capabilities;
  const expected = [
    "view", "manage-source", "manage-mappings", "run-import", "assess-readiness",
    "propose-cutover", "approve-cutover", "execute-cutover", "execute-rollback",
    "execute-repair", "remove-credential", "manage-legal-hold", "complete-migration",
    "redeliver-webhook", "delete-source",
  ];
  assert.deepEqual(capabilities, expected);
  assert.deepEqual(artifacts.schema.$defs.operatorCapabilities.properties.capabilities.items.enum, expected);
  assert.equal(artifacts.manifest.policy.operatorCapabilities, "affordanceEvidenceOnlyBackendAuthorizationAuthoritative");
});

test("cutover and rollback freeze distinct exact digest sets", () => {
  const manifest = loadPhase9CArtifacts("billingMigrationOperationsV1").manifest;
  assert.deepEqual(manifest.commandPreconditions.cutoverDigestKeys, [
    "scopeDigest", "manifestDigest", "mappingDigest", "policyDigest",
    "evidenceDigest", "readinessDigest", "finalWatermarkDigest",
    "applicationVersionDigest", "approvalDigest",
  ]);
  assert.deepEqual(manifest.commandPreconditions.rollbackDigestKeys, [
    "checkpointDigest", "authorityDigest", "rollbackPrerequisitesDigest",
    "approvalDigest",
  ]);
  assert.equal(manifest.commandPreconditions.approvalExpiry, "rejectAfterExpiresAt");
});

test("completion freezes credential removal and source-object retention", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const completion = fixture(artifacts, "/completion.json").payload;
  assert.ok(Date.parse(completion.credentialRemovedAt) >= Date.parse(completion.rollbackWindowEndedAt));
  assert.equal(Date.parse(completion.sourceObjectsDeleteAt) - Date.parse(completion.completedAt), 30 * 24 * 60 * 60 * 1000);
  const legalHold = fixture(artifacts, "completion-legal-hold.json").payload;
  assert.equal(legalHold.legalHold, true);
  assert.equal(legalHold.sourceObjectsDeleteAt, undefined);
  const vectors = fixture(artifacts, "vectors/completion-timing.json").vectors;
  for (const vector of vectors) assert.equal(completionTimingDecision(vector), vector.decision, vector.id);
});

test("repair records carry bounded scope and a complete audit result", () => {
  const artifacts = loadPhase9CArtifacts("billingMigrationOperationsV1");
  const repair = fixture(artifacts, "/repair.json").payload;
  assert.ok(repair.scope.references.length >= 1 && repair.scope.references.length <= 100);
  for (const field of ["actorId", "beforeDigest", "afterDigest", "result", "idempotencyKey", "reason", "caseId"]) assert.ok(repair[field], field);

  assert.equal(repair.executionStatus, "completed");
  const pending = fixture(artifacts, "repair-provider-validation-pending.json").payload;
  assert.equal(pending.executionStatus, "pending");
  assert.equal(pending.result, undefined);
  assert.ok(pending.beforeDigest);
  assert.equal(pending.afterDigest, undefined);
  assert.deepEqual(artifacts.schema.$defs.repair.allOf[1].properties.executionStatus.enum, [
    "pending", "completed",
  ]);
  assert.deepEqual(artifacts.schema.$defs.repair.allOf[1].properties.result.enum, [
    "succeeded", "failed", "no_change",
  ]);
  assert.equal(artifacts.manifest.policy.pendingRepairExecution, "durableReservationUnsettledNoAfterStateClaims");
});

test("webhook preserves signing/delivery and the consumer obligations", () => {
  const manifest = loadPhase9CArtifacts("billingStateWebhookV2").manifest;
  assert.equal(manifest.delivery.signing, "hmacSha256V1RawBodyUnchanged");
  assert.equal(manifest.delivery.eventIdOnRetry, "stable");
  assert.equal(manifest.delivery.deduplicationKey, "eventId");
  assert.equal(manifest.delivery.orderingKey, "snapshotVersion");
  assert.equal(manifest.delivery.failureIsolation, "deliveryNeverRollsBackState");
  assert.equal(manifest.consumerPolicy.signatureVerification, "requiredBeforeParsing");
  assert.equal(manifest.consumerPolicy.duplicateEvent, "deduplicateByEventId");
  assert.equal(manifest.consumerPolicy.ordering, "ignoreOlderSnapshotVersion");
});

test("every authority transition event has one exact authority kind and state", () => {
  const artifacts = loadPhase9CArtifacts("billingStateWebhookV2");
  for (const path of artifacts.validFixturePaths.filter((candidate) => candidate.includes("/events/"))) {
    const event = JSON.parse(readFileSync(path, "utf8")).payload;
    const binding = artifacts.manifest.authorityEventBindings[event.eventType];
    if (!binding) continue;
    assert.equal(event.authority.authorityKind, binding.authorityKind, event.eventType);
    assert.equal(event.authority.transitionState, binding.transitionState, event.eventType);
  }
});
