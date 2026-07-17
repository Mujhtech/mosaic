import assert from "node:assert/strict";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  classifyLocalRevision,
  loadPreviewArtifacts,
  parsePortablePaywallJson,
  previewMessageTypes,
  requiredPreviewCapabilities,
  serializePortablePaywallJson,
  validateMockCommerceState,
  validatePreviewArtifacts,
  validatePreviewJsonFormatting,
} from "./preview-validation.mjs";

function artifacts() {
  return structuredClone(loadPreviewArtifacts());
}

function validators(input = artifacts()) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(input.paywallSchema);
  const message = ajv.compile(input.previewMessageSchema);
  const localProject = ajv.compile(input.localProjectSchema);
  return { localProject, message };
}

function messageOfType(input, type, index = 0) {
  return input.messages.filter((message) => message.type === type)[index];
}

test("the Local Preview 0.1 schemas and generated fixtures are valid", () => {
  const input = artifacts();

  assert.deepEqual(validatePreviewArtifacts(input), []);
  assert.deepEqual(validatePreviewJsonFormatting(), []);
  assert.equal(input.manifest.status, "approved");
  assert.equal(input.manifest.releaseCandidate, "RC1");
});

test("the canonical flow exercises every required message type", () => {
  const input = artifacts();
  const actualTypes = new Set(input.messages.map((message) => message.type));

  assert.deepEqual(actualTypes, new Set(previewMessageTypes));
});

test("the first-party preview capability set is exact", () => {
  const input = artifacts();
  const report = messageOfType(input, "capabilityReport");

  assert.deepEqual(
    report.payload.previewCapabilities.map((capability) => capability.name),
    requiredPreviewCapabilities,
  );
});

test("a preview message rejects an unknown envelope property", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "previewHeartbeat");
  message.authorization = "not-a-contract-field";

  assert.equal(validate(message), false);
});

test("a preview message rejects an unknown payload property", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "draftAccepted");
  message.payload.platformWidget = "never";

  assert.equal(validate(message), false);
});

test("a preview message requires the exact contract version", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "previewHeartbeat");
  message.previewProtocolVersion = "0.2";

  assert.equal(validate(message), false);
});

test("utcTimestamp validation is the schema's exact closed regex", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "previewHeartbeat");
  message.sentAt = "2026-07-17T99:00:00Z";

  assert.equal(validate(message), true);
});

test("a payload cannot be paired with the wrong discriminator", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "draftAccepted");
  message.type = "previewHeartbeat";

  assert.equal(validate(message), false);
});

test("client identity rejects framework-specific fields", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const message = messageOfType(input, "previewClientConnected");
  message.payload.client.flutterVersion = "1.0.0";

  assert.equal(validate(message), false);
});

test("capability reports reject an unknown preview capability", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const report = messageOfType(input, "capabilityReport");
  report.payload.previewCapabilities[0].name = "preview.remotePublish";

  assert.equal(validate(report), false);
});

test("capability reports reject duplicate preview capabilities", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const report = messageOfType(input, "capabilityReport");
  report.payload.previewCapabilities.push(
    structuredClone(report.payload.previewCapabilities[0]),
  );

  assert.equal(validate(report), false);
});

test("draft updates use the immutable Protocol 0.1 paywall schema", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const update = messageOfType(input, "draftUpdated");
  update.payload.document.executable = "never";

  assert.equal(validate(update), false);
});

test("local project files reject account and hosted-project fields", () => {
  const input = artifacts();
  const validate = validators(input).localProject;
  input.localProject.organizationId = "organization_hosted";

  assert.equal(validate(input.localProject), false);
});

test("local project files do not persist transient editor selection", () => {
  const input = artifacts();
  const validate = validators(input).localProject;
  input.localProject.selectedComponentId = "headline";

  assert.equal(validate(input.localProject), false);
});

test("diagnostics reject multiline raw errors", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const failure = messageOfType(input, "renderFailure");
  failure.payload.failure.message = "safe summary\nstack trace";

  assert.equal(validate(failure), false);
});

test("diagnostics reject unstructured internal details", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const failure = messageOfType(input, "renderFailure");
  failure.payload.failure.rawError = "internal exception";

  assert.equal(validate(failure), false);
});

test("recovery actions cannot carry executable commands", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const failure = messageOfType(input, "renderFailure");
  failure.payload.failure.recovery.action = "runCommand";

  assert.equal(validate(failure), false);
});

test("render failures must keep the last accepted draft", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const failure = messageOfType(input, "renderFailure");
  failure.payload.failure.fallback = "partialRender";

  assert.equal(validate(failure), false);
});

test("blocking compatibility warnings must keep the last accepted draft", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const warning = messageOfType(input, "renderWarning");
  warning.payload.warnings[0].severity = "blocking";
  warning.payload.warnings[0].fallback = "nativeApproximation";

  assert.equal(validate(warning), false);
});

test("unavailable mock products cannot carry price data", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const commerce = messageOfType(input, "mockCommerceStateChanged");
  commerce.payload.state.products[0] = {
    productReferenceId: "monthly-plan",
    availability: "unavailable",
    reason: "temporarilyUnavailable",
    localizedPrice: "$9.99",
  };

  assert.equal(validate(commerce), false);
});

test("the message schema permits empty commerce for a product-free document", () => {
  const input = artifacts();
  const validate = validators(input).message;
  const commerce = messageOfType(input, "mockCommerceStateChanged");
  commerce.payload.state.products = [];
  commerce.payload.state.entitlement = { status: "none" };

  assert.equal(validate(commerce), true);
});

test("mock commerce requires one state for every document product", () => {
  const input = artifacts();
  input.localProject.mockCommerce.state.products.pop();

  assert.ok(
    validateMockCommerceState(
      input.localProject.document,
      input.localProject.mockCommerce.state,
    ).some((error) => error.includes("omits document product yearly-plan")),
  );
});

test("mock commerce rejects unknown and duplicate product references", () => {
  const input = artifacts();
  const state = input.localProject.mockCommerce.state;
  state.products[1].productReferenceId = "monthly-plan";
  state.products.push({
    productReferenceId: "unknown-plan",
    availability: "unavailable",
    reason: "notConfigured",
  });
  const errors = validateMockCommerceState(input.localProject.document, state);

  assert.ok(errors.some((error) => error.includes("duplicate monthly-plan")));
  assert.ok(errors.some((error) => error.includes("unknown product unknown-plan")));
});

test("mock entitlements must reference a document product", () => {
  const input = artifacts();
  const state = input.localProject.mockCommerce.state;
  state.entitlement = {
    status: "active",
    productReferenceId: "unknown-plan",
  };

  assert.ok(
    validateMockCommerceState(input.localProject.document, state).some(
      (error) => error.includes("mock entitlement references unknown product"),
    ),
  );
});

test("local revision ordering distinguishes newer, stale, duplicate, and conflict", () => {
  const highestSeen = { revisionId: "revision_000010", sequence: 10 };

  assert.equal(
    classifyLocalRevision(highestSeen, {
      revisionId: "revision_000011",
      sequence: 11,
    }),
    "newer",
  );
  assert.equal(
    classifyLocalRevision(highestSeen, {
      revisionId: "revision_000009",
      sequence: 9,
    }),
    "stale",
  );
  assert.equal(
    classifyLocalRevision(highestSeen, structuredClone(highestSeen)),
    "duplicate",
  );
  assert.equal(
    classifyLocalRevision(highestSeen, {
      revisionId: "revision_conflict",
      sequence: 10,
    }),
    "conflict",
  );
});

test("the canonical flow rejects an older draft revision", () => {
  const input = artifacts();
  const rejection = input.messages.find(
    (message) =>
      message.type === "draftRejected" &&
      message.payload.reason === "staleRevision",
  );

  assert.ok(rejection);
  assert.equal(rejection.payload.revision.sequence, 1);
  assert.equal(rejection.payload.diagnostics[0].code, "preview.staleRevision");
  assert.equal(
    rejection.payload.diagnostics[0].recovery.action,
    "restoreLastValidDraft",
  );
});

test("portable import accepts the raw Protocol 0.1 document", () => {
  const input = artifacts();
  const result = parsePortablePaywallJson(
    JSON.stringify(input.localProject.document),
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.document, input.localProject.document);
});

test("portable import rejects the local project wrapper", () => {
  const input = artifacts();
  const result = parsePortablePaywallJson(JSON.stringify(input.localProject));

  assert.notDeepEqual(result.errors, []);
  assert.equal(result.document, null);
});

test("portable import enforces its byte limit before parsing", () => {
  const result = parsePortablePaywallJson("{}", { maxDocumentBytes: 1 });

  assert.deepEqual(result.errors, [
    "import exceeds the local preview document byte limit",
  ]);
  assert.equal(result.document, null);
});

test("portable import reports malformed JSON without raw parser details", () => {
  const result = parsePortablePaywallJson("{not-json}");

  assert.deepEqual(result.errors, ["import is not valid JSON"]);
  assert.equal(result.document, null);
});

test("portable export contains only canonical raw paywall JSON", () => {
  const input = artifacts();
  const exported = serializePortablePaywallJson(input.localProject.document);
  const parsed = JSON.parse(exported);

  assert.ok(exported.endsWith("\n"));
  assert.equal(parsed.schemaVersion, "0.1");
  assert.equal(Object.hasOwn(parsed, "editableDocumentId"), false);
  assert.equal(Object.hasOwn(parsed, "mockCommerce"), false);
  assert.equal(Object.hasOwn(parsed, "preview"), false);
});

test("portable export refuses a semantically invalid document", () => {
  const input = artifacts();
  input.localProject.document.layout.content.children[5].productReferenceIds[0] =
    "missing-plan";

  assert.throws(
    () => serializePortablePaywallJson(input.localProject.document),
    /cannot export an invalid Mosaic paywall document/,
  );
});

test("render failure and rejection share one recovery action", () => {
  const input = artifacts();
  const failure = messageOfType(input, "renderFailure");
  const rejection = input.messages.find(
    (message) =>
      message.type === "draftRejected" &&
      message.payload.reason === "renderFailed",
  );

  assert.deepEqual(
    rejection.payload.diagnostics[0].recovery,
    failure.payload.failure.recovery,
  );
});
