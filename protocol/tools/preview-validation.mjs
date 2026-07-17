import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { buildLocalPreviewFixtures } from "./generate-local-preview-fixtures.mjs";
import {
  loadProtocolArtifacts,
  validateProtocol,
} from "./validation.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const previewProtocolRoot = resolve(toolsDirectory, "..");

export const previewPaths = Object.freeze({
  localProjectFixture: resolve(
    previewProtocolRoot,
    "fixtures/local-preview/v0.1/local-project.json",
  ),
  messageFixture: resolve(
    previewProtocolRoot,
    "fixtures/local-preview/v0.1/session-flow.messages.json",
  ),
  localProjectSchema: resolve(
    previewProtocolRoot,
    "schema/local-preview/v0.1/local-project.schema.json",
  ),
  previewMessageSchema: resolve(
    previewProtocolRoot,
    "schema/local-preview/v0.1/preview-message.schema.json",
  ),
});

export const previewMessageTypes = Object.freeze([
  "previewClientConnected",
  "previewClientDisconnected",
  "capabilityReport",
  "draftUpdated",
  "draftAccepted",
  "draftRejected",
  "validationError",
  "renderWarning",
  "renderFailure",
  "mockCommerceStateChanged",
  "previewHeartbeat",
]);

export const requiredPreviewCapabilities = Object.freeze([
  "preview.liveUpdate",
  "preview.mockCommerce",
  "preview.localeOverride",
  "preview.textScale",
  "preview.diagnostics",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadPreviewArtifacts() {
  const phase1 = loadProtocolArtifacts();

  return {
    ...phase1,
    localProject: readJson(previewPaths.localProjectFixture),
    localProjectSchema: readJson(previewPaths.localProjectSchema),
    messages: readJson(previewPaths.messageFixture),
    previewMessageSchema: readJson(previewPaths.previewMessageSchema),
  };
}

function createPreviewValidators({
  localProjectSchema,
  paywallSchema,
  previewMessageSchema,
}) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(paywallSchema);
  const message = ajv.compile(previewMessageSchema);
  const localProject = ajv.compile(localProjectSchema);

  return { localProject, message };
}

function formatSchemaErrors(label, validationErrors = []) {
  return validationErrors.map((error) => {
    const location = error.instancePath || "/";
    return `${label}${location} ${error.message ?? "is invalid"}`;
  });
}

function revisionKey(editableDocumentId, revision) {
  return `${editableDocumentId}:${revision.sequence}:${revision.revisionId}`;
}

function addDuplicateErrors(errors, entries, value, label) {
  const seen = new Set();

  for (const entry of entries) {
    const key = value(entry);
    if (seen.has(key)) {
      errors.push(`${label} contains duplicate ${key}`);
    }
    seen.add(key);
  }
}

export function classifyLocalRevision(highestSeen, incoming) {
  if (highestSeen === null || incoming.sequence > highestSeen.sequence) {
    return "newer";
  }
  if (incoming.sequence < highestSeen.sequence) {
    return "stale";
  }
  return incoming.revisionId === highestSeen.revisionId
    ? "duplicate"
    : "conflict";
}

export function validateMockCommerceState(document, state) {
  const errors = [];
  const documentProductIds = document.products.map((product) => product.id);
  const mockProductIds = state.products.map(
    (product) => product.productReferenceId,
  );

  addDuplicateErrors(
    errors,
    state.products,
    (product) => product.productReferenceId,
    "mock commerce products",
  );

  for (const productId of mockProductIds) {
    if (!documentProductIds.includes(productId)) {
      errors.push(`mock commerce references unknown product ${productId}`);
    }
  }
  for (const productId of documentProductIds) {
    if (!mockProductIds.includes(productId)) {
      errors.push(`mock commerce omits document product ${productId}`);
    }
  }

  if (
    state.entitlement.status === "active" &&
    !documentProductIds.includes(state.entitlement.productReferenceId)
  ) {
    errors.push(
      `mock entitlement references unknown product ` +
        state.entitlement.productReferenceId,
    );
  }

  return errors;
}

export function validatePortablePaywallDocument(
  document,
  artifacts = loadProtocolArtifacts(),
) {
  return validateProtocol({
    document,
    manifest: artifacts.manifest,
    manifestSchema: artifacts.manifestSchema,
    paywallSchema: artifacts.paywallSchema,
  });
}

export function parsePortablePaywallJson(
  source,
  { maxDocumentBytes = 1048576, artifacts = loadProtocolArtifacts() } = {},
) {
  if (Buffer.byteLength(source, "utf8") > maxDocumentBytes) {
    return {
      document: null,
      errors: ["import exceeds the local preview document byte limit"],
    };
  }

  let document;
  try {
    document = JSON.parse(source);
  } catch {
    return {
      document: null,
      errors: ["import is not valid JSON"],
    };
  }

  const errors = validatePortablePaywallDocument(document, artifacts);
  return {
    document: errors.length === 0 ? document : null,
    errors,
  };
}

export function serializePortablePaywallJson(
  document,
  artifacts = loadProtocolArtifacts(),
) {
  const errors = validatePortablePaywallDocument(document, artifacts);
  if (errors.length > 0) {
    throw new Error("cannot export an invalid Mosaic paywall document");
  }

  return `${JSON.stringify(document, null, 2)}\n`;
}

function validateGeneratedFixtures(errors, localProject, messages) {
  const generated = buildLocalPreviewFixtures();

  if (JSON.stringify(localProject) !== JSON.stringify(generated.localProject)) {
    errors.push(
      "local preview project fixture is stale; regenerate it with " +
        "npm run generate:preview-fixtures",
    );
  }
  if (JSON.stringify(messages) !== JSON.stringify(generated.messages)) {
    errors.push(
      "local preview message fixture is stale; regenerate it with " +
        "npm run generate:preview-fixtures",
    );
  }
}

function validateMessageFlow(errors, artifacts) {
  const {
    manifest,
    manifestSchema,
    messages,
    paywallSchema,
  } = artifacts;
  const types = new Set(messages.map((message) => message.type));
  const sessions = new Set(messages.map((message) => message.sessionId));
  const messageIds = new Set();
  const drafts = new Map();
  const validationEvents = new Set();
  const renderFailures = new Map();
  const clientIds = new Set();

  for (const requiredType of previewMessageTypes) {
    if (!types.has(requiredType)) {
      errors.push(`preview fixture omits message type ${requiredType}`);
    }
  }
  if (sessions.size !== 1) {
    errors.push("preview fixture must exercise exactly one local session");
  }

  for (const message of messages) {
    if (messageIds.has(message.messageId)) {
      errors.push(`preview fixture repeats message ID ${message.messageId}`);
    }
    messageIds.add(message.messageId);

    const clientId =
      message.payload.clientId ?? message.payload.client?.clientId ?? null;
    if (clientId) {
      clientIds.add(clientId);
    }

    if (message.type === "draftUpdated") {
      drafts.set(
        revisionKey(
          message.payload.editableDocumentId,
          message.payload.revision,
        ),
        message.payload.document,
      );
    }
    if (message.type === "validationError") {
      validationEvents.add(
        revisionKey(
          message.payload.editableDocumentId,
          message.payload.revision,
        ),
      );
    }
    if (message.type === "renderFailure") {
      renderFailures.set(
        revisionKey(
          message.payload.editableDocumentId,
          message.payload.revision,
        ),
        message.payload.failure,
      );
    }
  }

  if (clientIds.size !== 1) {
    errors.push("preview fixture must use one stable client ID");
  }

  const capabilityReports = messages.filter(
    (message) => message.type === "capabilityReport",
  );
  for (const report of capabilityReports) {
    addDuplicateErrors(
      errors,
      report.payload.supportedCapabilities,
      (capability) => capability.name,
      "supported capabilities",
    );
    addDuplicateErrors(
      errors,
      report.payload.previewCapabilities,
      (capability) => capability.name,
      "preview capabilities",
    );
    const names = report.payload.previewCapabilities.map(
      (capability) => capability.name,
    );
    for (const required of requiredPreviewCapabilities) {
      if (!names.includes(required)) {
        errors.push(`capability report omits ${required}`);
      }
    }

    const supported = new Map(
      report.payload.supportedCapabilities.map((capability) => [
        capability.name,
        capability.version,
      ]),
    );
    for (const capability of manifest.capabilities) {
      if (supported.get(capability.name) !== capability.version) {
        errors.push(
          `capability report does not support ${capability.name}@` +
            capability.version,
        );
      }
    }
  }

  for (const message of messages) {
    if (message.type !== "mockCommerceStateChanged") {
      continue;
    }
    errors.push(
      ...validateMockCommerceState(
        artifacts.localProject.document,
        message.payload.state,
      ).map((error) => `mock commerce message: ${error}`),
    );
  }

  for (const message of messages) {
    if (
      message.type !== "draftAccepted" &&
      message.type !== "draftRejected"
    ) {
      continue;
    }

    const key = revisionKey(
      message.payload.editableDocumentId,
      message.payload.revision,
    );
    const document = drafts.get(key);
    if (!document) {
      errors.push(`${message.type} references an unknown draft revision`);
      continue;
    }

    const documentErrors = validateProtocol({
      document,
      manifest,
      manifestSchema,
      paywallSchema,
    });

    if (message.type === "draftAccepted" && documentErrors.length > 0) {
      errors.push("draftAccepted acknowledges a semantically invalid document");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "validationFailed" &&
      documentErrors.length === 0
    ) {
      errors.push("validationFailed rejects a semantically valid document");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "validationFailed" &&
      !validationEvents.has(key)
    ) {
      errors.push("validationFailed has no correlated validationError event");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "renderFailed"
    ) {
      const failure = renderFailures.get(key);
      if (!failure) {
        errors.push("renderFailed has no correlated renderFailure event");
      } else {
        const rejectionDiagnostic = message.payload.diagnostics[0];
        if (
          rejectionDiagnostic.code !== failure.code ||
          JSON.stringify(rejectionDiagnostic.recovery) !==
            JSON.stringify(failure.recovery)
        ) {
          errors.push(
            "render failure and rejection diagnostics disagree on recovery",
          );
        }
      }
    }
  }
}

export function validatePreviewArtifacts(artifacts) {
  const validators = createPreviewValidators(artifacts);
  const errors = [];

  for (const [index, message] of artifacts.messages.entries()) {
    if (!validators.message(message)) {
      errors.push(
        ...formatSchemaErrors(
          `messages/${index}`,
          validators.message.errors,
        ),
      );
    }
  }
  if (!validators.localProject(artifacts.localProject)) {
    errors.push(
      ...formatSchemaErrors(
        "localProject",
        validators.localProject.errors,
      ),
    );
  }

  if (errors.length > 0) {
    return errors;
  }

  const localProjectErrors = validateProtocol({
    document: artifacts.localProject.document,
    manifest: artifacts.manifest,
    manifestSchema: artifacts.manifestSchema,
    paywallSchema: artifacts.paywallSchema,
  });
  errors.push(
    ...localProjectErrors.map((error) => `local project document: ${error}`),
  );
  errors.push(
    ...validateMockCommerceState(
      artifacts.localProject.document,
      artifacts.localProject.mockCommerce.state,
    ),
  );

  validateGeneratedFixtures(
    errors,
    artifacts.localProject,
    artifacts.messages,
  );
  validateMessageFlow(errors, artifacts);

  return errors;
}

export function validatePreviewJsonFormatting() {
  const errors = [];

  for (const filePath of Object.values(previewPaths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;

    if (source !== formatted) {
      errors.push(
        `${relative(previewProtocolRoot, filePath)} is not canonical JSON`,
      );
    }
  }

  return errors;
}
