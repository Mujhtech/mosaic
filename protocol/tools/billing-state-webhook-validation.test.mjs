import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  validateWebhookSummaryAccessVocabulary,
  webhookDeliverySemantics,
  webhookEventSemantics,
} from "./billing-state-webhook-validation.mjs";
import { loadPhase9CArtifacts, validatePhase9CArtifacts } from "./phase9c-contract-validation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = loadPhase9CArtifacts("billingStateWebhookV2");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const signatureVectors = readJson(
  resolve(root, "../packages/test-fixtures/src/webhook-signature-vectors.json"),
);

function fixture(name) {
  const path = artifacts.fixturePaths.find((candidate) =>
    candidate.endsWith(`/${name}`),
  );
  assert.ok(path, `Missing fixture ${name}`);
  return readJson(path);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
for (const schema of [artifacts.schema, artifacts.manifestSchema]) ajv.addSchema(schema);
const validateRecord = ajv.getSchema(artifacts.schema.$id);

test("the manifest is born a draft and emits five of its fourteen event types", () => {
  const manifest = artifacts.manifest;
  assert.equal(manifest.status, "draft");
  assert.equal(manifest.eventTypes.length, 14);
  assert.deepEqual(manifest.emittedEventTypes, [
    "customer.entitlements.changed",
    "authority.cutover.pending",
    "authority.cutover.completed",
    "authority.rollback.completed",
    "authority.stabilization.completed",
  ]);
  // Over-provisioning is the point: the nine reserved names carried forward
  // from Contract 1 cost no contract version when they start being emitted.
  for (const eventType of manifest.emittedEventTypes) {
    assert.ok(manifest.eventTypes.includes(eventType));
  }
});

test("the public event vocabulary never names a provider", () => {
  for (const eventType of artifacts.schema.$defs.event.properties.eventType.enum) {
    assert.doesNotMatch(eventType, /apple|google|storekit|play|itunes/i, eventType);
  }
  const document = fixture("events/entitlement-activated.json");
  document.payload.eventType = "subscription.expired";
  assert.equal(validateRecord(document), true, JSON.stringify(validateRecord.errors));
  assert.deepEqual(webhookEventSemantics("event", document.payload), []);
});

test("consumer tolerance is the documented exception to fail-closed reading", () => {
  // Producers are strict; consumers are tolerant. Recorded as an explicit
  // asymmetry so it stays an exception rather than becoming a habit.
  const manifest = artifacts.manifest;
  assert.equal(manifest.producerPolicy.unknownField, "rejectRecord");
  assert.equal(manifest.producerPolicy.unknownEventType, "rejectRecord");
  assert.equal(manifest.consumerPolicy.unknownField, "ignore");
  assert.equal(manifest.consumerPolicy.unknownEventType, "ignore");
  assert.equal(manifest.consumerPolicy.unknownEnumeration, "ignore");
  assert.equal(
    manifest.consumerPolicy.authoritativeState,
    "reReadAuthoritativeEntitlementV2",
  );
  // The one thing a consumer must not be tolerant about.
  assert.equal(
    manifest.consumerPolicy.signatureVerification,
    "requiredBeforeParsing",
  );
});

test("the validator enforces the re-read counterweight, not just the manifest text", () => {
  // The three `ignore` arms are the protocol's only tolerant reader policy. They
  // are safe solely because the consumer re-reads the authoritative snapshot. If
  // that requirement is dropped or reworded, validation must fail rather than
  // leave the tolerance standing alone.
  for (const mutate of [
    (manifest) => delete manifest.consumerPolicy.authoritativeState,
    (manifest) => {
      manifest.consumerPolicy.authoritativeState = "projectFromEvent";
    },
    (manifest) => {
      manifest.consumerPolicy.authoritativeState = "reReadSnapshotIfConvenient";
    },
    (manifest) => {
      manifest.consumerPolicy.signatureVerification = "optional";
    },
    (manifest) => delete manifest.consumerPolicy,
  ]) {
    const broken = { ...artifacts, manifest: structuredClone(artifacts.manifest) };
    mutate(broken.manifest);
    const errors = validatePhase9CArtifacts(broken);
    assert.ok(
      errors.some((error) =>
        /consumerPolicy|may never project entitlement state/.test(error),
      ),
      `expected a consumer-policy error, got: ${errors.join("; ")}`,
    );
  }
});

test("delivery is at least once and ordered by snapshot version", () => {
  const manifest = artifacts.manifest;
  assert.equal(manifest.delivery.semantics, "atLeastOnce");
  assert.equal(manifest.delivery.deduplicationKey, "eventId");
  assert.equal(manifest.delivery.orderingKey, "snapshotVersion");
  assert.equal(manifest.producerPolicy.exactlyOnceDelivery, "neverPromised");
  assert.equal(
    manifest.delivery.failureIsolation,
    "deliveryNeverRollsBackState",
  );
});

test("a retry carries the same event ID with a higher attempt", () => {
  // The property consumer-side deduplication depends on.
  const first = fixture("deliveries/failed-retry-scheduled.json");
  const retry = fixture("deliveries/retry-same-event-id.json");
  assert.equal(retry.payload.eventId, first.payload.eventId);
  assert.equal(retry.payload.attempt, first.payload.attempt + 1);
  assert.notEqual(retry.payload.deliveryId, first.payload.deliveryId);
});

test("exhaustion means the attempts actually ran out", () => {
  const document = fixture("deliveries/exhausted.json");
  assert.equal(document.payload.attempt, document.payload.maxAttempts);
  document.payload.attempt = 3;
  assert.notDeepEqual(webhookDeliverySemantics("delivery", document.payload), []);
});

test("a delivery record carries no destination URL and no signing secret", () => {
  // It is operator-facing and never transmitted; a URL or secret here would be
  // read by everyone with dashboard access.
  const properties = Object.keys(
    artifacts.schema.$defs.webhookDeliveryAttempt.properties,
  );
  for (const name of properties) {
    assert.doesNotMatch(name, /url|secret|signature|endpoint|token/i, name);
  }
  assert.equal(
    artifacts.manifest.producerPolicy.deliveryRecordTransport,
    "neverSentToDestination",
  );
});

test("an event must report a change", () => {
  // A no-change projection emits no webhook, so an event that changes nothing is
  // a producer defect rather than a quiet no-op.
  const document = fixture("events/entitlement-deactivated.json");
  document.payload.changedEntitlements[0].currentState = "active";
  const errors = webhookEventSemantics("event", document.payload);
  assert.ok(
    errors.some((error) => error.includes("reports no state change")),
    `expected a no-change error, got: ${errors.join("; ")}`,
  );

  // A period change legitimately leaves every state untouched.
  const extended = fixture("events/expiry-extended.json");
  assert.equal(extended.payload.sourceReason, "subscription_period_changed");
  assert.equal(
    extended.payload.changedEntitlements[0].previousState,
    extended.payload.changedEntitlements[0].currentState,
  );
  assert.deepEqual(webhookEventSemantics("event", extended.payload), []);
});

test("a rollback opens a new authority epoch whose snapshot versions restart", () => {
  // The Contract 1 monotonic gate applies within an epoch; a rollback event
  // legitimately reports a lower snapshot version under its new epoch.
  const rollback = fixture("events/rollback-completed.json");
  assert.ok(rollback.payload.snapshotVersion < rollback.payload.previousSnapshotVersion);
  assert.deepEqual(webhookEventSemantics("event", rollback.payload), []);

  const regressed = fixture("events/entitlement-deactivated.json");
  regressed.payload.snapshotVersion = regressed.payload.previousSnapshotVersion;
  assert.notDeepEqual(webhookEventSemantics("event", regressed.payload), []);
});

test("cancellation is reported without deactivating access", () => {
  const document = fixture("events/subscription-cancelled-access-active.json");
  assert.equal(document.payload.stateSummary.accessState, "active");
  assert.equal(document.payload.stateSummary.renewalIntent, "auto_renew_disabled");
  assert.equal(document.payload.changedEntitlements[0].currentState, "active");
});

test("an unknown transition is reported as unknown, never as a deactivation", () => {
  const document = fixture("events/unknown-state-transition.json");
  assert.equal(document.payload.changedEntitlements[0].currentState, "unknown");
  assert.equal(document.payload.stateSummary.accessState, "unknown");
  assert.notEqual(document.payload.stateSummary.uncertainty.reason, "none");
});

test("an event's access state is never unavailable", () => {
  // unavailable says Mosaic could not answer a read. An event is not a read: it
  // exists because a projection committed a snapshot, so the projection did
  // answer. The worst it can say is unknown, with an uncertainty attached.
  assert.deepEqual(artifacts.schema.$defs.accessState.enum, [
    "active",
    "inactive",
    "unknown",
  ]);

  const document = fixture("events/unknown-state-transition.json");
  document.payload.stateSummary.accessState = "unavailable";
  assert.equal(validateRecord(document), false);

  for (const path of artifacts.validFixturePaths) {
    const candidate = readJson(path);
    if (candidate.recordType !== "billingStateEvent") continue;
    assert.notEqual(candidate.payload.stateSummary?.accessState, "unavailable");
  }
});

test("the contract guard rejects an accessState vocabulary that admits unavailable", () => {
  // Exercised by breaking it: the narrowing has to be defended, not merely
  // performed, or a later edit re-widens it without anything noticing.
  const broken = structuredClone(artifacts.schema);
  broken.$defs.accessState.enum.push("unavailable");
  const errors = validateWebhookSummaryAccessVocabulary(broken);
  assert.ok(
    errors.some((error) => error.includes("may never include unavailable")),
    `expected an unavailable-vocabulary error, got: ${errors.join("; ")}`,
  );
});

test("no fixture carries a signed-payload-shaped value", () => {
  const jws = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  for (const path of artifacts.validFixturePaths) {
    for (const value of strings(readJson(path))) assert.doesNotMatch(value, jws);
  }
});

test("every signature vector is the HMAC of its own signed payload", () => {
  const { scheme, vectors } = signatureVectors;
  assert.equal(scheme.algorithm, "HMAC-SHA256");
  assert.equal(scheme.signingVersion, "v1");

  for (const vector of vectors) {
    assert.equal(
      vector.signedPayload,
      `${scheme.signingVersion}.${vector.timestamp}.${vector.eventId}.${vector.rawBody}`,
      `${vector.id} signed payload does not follow the template`,
    );
    assert.equal(
      createHmac("sha256", vector.secret).update(vector.signedPayload, "utf8").digest("hex"),
      vector.signature,
      `${vector.id} signature is not HMAC-SHA256 over its signed payload`,
    );
    assert.match(vector.signature, /^[a-f0-9]{64}$/);
    assert.equal(vector.header, `t=${vector.timestamp}, v1=${vector.signature}`);
  }
});

test("the signature covers the body, the event ID, and the timestamp", () => {
  const byId = Object.fromEntries(
    signatureVectors.vectors.map((vector) => [vector.id, vector]),
  );
  const canonical = byId["canonical-event-primary-key"];
  for (const id of [
    "tampered-body-must-not-verify",
    "different-event-id-must-not-verify",
    "different-timestamp-must-not-verify",
    "canonical-event-rotation-key",
  ]) {
    assert.notEqual(
      byId[id].signature,
      canonical.signature,
      `${id} produces the same signature as the canonical vector`,
    );
  }
  // Rotation: two active keys over identical bytes, either verifying is enough.
  const rotated = byId["canonical-event-rotation-key"];
  assert.equal(rotated.rawBody, canonical.rawBody);
  assert.equal(rotated.eventId, canonical.eventId);
  assert.notEqual(rotated.secret, canonical.secret);
});
