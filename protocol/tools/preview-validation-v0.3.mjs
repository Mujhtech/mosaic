import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  loadProtocolV03Artifacts,
  runtimeStateForAcceptedV03Revision,
  validateProtocolV03,
} from "./validation-v0.3.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const previewV03Root = resolve(toolsDirectory, "..");

export const previewV03Paths = Object.freeze({
  acceptedRevisionRuntimeResetFixture: resolve(
    previewV03Root,
    "fixtures/local-preview/v0.3/accepted-revision-runtime-reset.json",
  ),
  localProjectFixture: resolve(
    previewV03Root,
    "fixtures/local-preview/v0.3/local-project.json",
  ),
  messageFixture: resolve(
    previewV03Root,
    "fixtures/local-preview/v0.3/session-flow.messages.json",
  ),
  localProjectSchema: resolve(
    previewV03Root,
    "schema/local-preview/v0.3/local-project.schema.json",
  ),
  previewMessageSchema: resolve(
    previewV03Root,
    "schema/local-preview/v0.3/preview-message.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    previewV03Root,
    "schema/local-preview/v0.3/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    previewV03Root,
    "compatibility/local-preview/v0.3.json",
  ),
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadPreviewV03Artifacts() {
  return {
    ...loadProtocolV03Artifacts(),
    acceptedRevisionRuntimeReset: readJson(
      previewV03Paths.acceptedRevisionRuntimeResetFixture,
    ),
    localProject: readJson(previewV03Paths.localProjectFixture),
    localProjectSchema: readJson(previewV03Paths.localProjectSchema),
    messages: readJson(previewV03Paths.messageFixture),
    previewMessageSchema: readJson(previewV03Paths.previewMessageSchema),
    localPreviewManifestSchema: readJson(
      previewV03Paths.compatibilityManifestSchema,
    ),
    localPreviewManifest: readJson(previewV03Paths.compatibilityManifest),
  };
}

function schemaValidators(artifacts) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(artifacts.paywallSchema);
  ajv.addSchema(artifacts.previewMessageSchema);
  return {
    localProject: ajv.compile(artifacts.localProjectSchema),
    message: ajv.getSchema(artifacts.previewMessageSchema.$id),
    localPreviewManifest: ajv.compile(artifacts.localPreviewManifestSchema),
  };
}

export const localPreviewV03VersionPreference = Object.freeze(["0.3"]);
/**
 * Every structured diagnostic code `decideLocalPreviewDraftDelivery` can emit.
 * The Local Preview 0.3 compatibility manifest must declare exactly this set.
 */
export const localPreviewV03DeliveryDiagnosticCodes = Object.freeze([
  "preview.noMutualVersion",
  "preview.invalidNegotiation",
  "preview.invalidDraft",
  "preview.incompatibleSchemaVersion",
  "preview.invalidCapabilityReport",
  "preview.unsupportedPreviewCapability",
  "preview.unsupportedCapability",
  "preview.documentTooLarge",
]);
export const requiredLocalPreviewV03Capabilities = Object.freeze([
  ...readJson(previewV03Paths.previewMessageSchema).$defs.previewCapabilityName
    .enum,
]);

function validateMockCommerceState(document, state) {
  const errors = [];
  const documentProductIds = document.products.map((product) => product.id);
  const mockProductIds = state.products.map(
    (product) => product.productReferenceId,
  );
  const seen = new Set();
  for (const productId of mockProductIds) {
    if (seen.has(productId)) {
      errors.push(`duplicate mock commerce product ${productId}`);
    }
    seen.add(productId);
    if (!documentProductIds.includes(productId)) {
      errors.push(`mock commerce references unknown product ${productId}`);
    }
  }
  for (const productId of documentProductIds) {
    if (!seen.has(productId)) {
      errors.push(`mock commerce omits document product ${productId}`);
    }
  }
  if (
    state.entitlement.status === "active" &&
    !documentProductIds.includes(state.entitlement.productReferenceId)
  ) {
    errors.push(
      `mock entitlement references unknown product ${state.entitlement.productReferenceId}`,
    );
  }
  return errors;
}

function structuredDeliveryDiagnostic({
  action = "updatePreviewClient",
  code,
  message,
  recoveryMessage,
}) {
  return {
    code,
    message,
    fallback: "keepLastAcceptedDraft",
    recovery: {
      action,
      message: recoveryMessage,
    },
  };
}

function incompatibleSchemaDiagnostic() {
  return {
    code: "preview.incompatibleSchemaVersion",
    message: "This preview client cannot receive the current Protocol 0.3 draft.",
    fallback: "keepLastAcceptedDraft",
    recovery: {
      action: "updatePreviewClient",
      message:
        "Update the preview client to a version that supports Local Preview and Protocol 0.3.",
    },
  };
}

export function negotiateLocalPreviewVersion(
  localSupportedVersions,
  remoteSupportedVersions,
) {
  const local = new Set(
    Array.isArray(localSupportedVersions) ? localSupportedVersions : [],
  );
  const remote = new Set(
    Array.isArray(remoteSupportedVersions) ? remoteSupportedVersions : [],
  );
  const selectedVersion = localPreviewV03VersionPreference.find(
    (version) => local.has(version) && remote.has(version),
  );
  if (!selectedVersion) {
    return {
      ok: false,
      selectedVersion: null,
      selectedWebSocketSubprotocol: null,
      diagnostic: {
        code: "preview.noMutualVersion",
        message: "Studio and the preview client have no mutually supported Local Preview version.",
        fallback: "keepLastAcceptedDraft",
        recovery: {
          action: "updatePreviewClient",
          message: "Update Studio or the preview client to a mutually supported version.",
        },
      },
    };
  }
  return {
    ok: true,
    selectedVersion,
    selectedWebSocketSubprotocol: `mosaic.local-preview.v${selectedVersion}`,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidUniqueCapabilities(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const capability of value) {
    if (
      !isRecord(capability) ||
      typeof capability.name !== "string" ||
      capability.name.length === 0 ||
      typeof capability.version !== "string" ||
      capability.version.length === 0 ||
      seen.has(capability.name)
    ) {
      return false;
    }
    seen.add(capability.name);
  }
  return true;
}

function isWellFormedCapabilityReport(capabilityReport) {
  return (
    isRecord(capabilityReport) &&
    typeof capabilityReport.clientId === "string" &&
    capabilityReport.clientId.length > 0 &&
    Array.isArray(capabilityReport.supportedSchemaVersions) &&
    capabilityReport.supportedSchemaVersions.length > 0 &&
    capabilityReport.supportedSchemaVersions.every(
      (version) => typeof version === "string" && version.length > 0,
    ) &&
    new Set(capabilityReport.supportedSchemaVersions).size ===
      capabilityReport.supportedSchemaVersions.length &&
    hasValidUniqueCapabilities(capabilityReport.supportedCapabilities) &&
    hasValidUniqueCapabilities(capabilityReport.previewCapabilities) &&
    isRecord(capabilityReport.limits) &&
    Number.isInteger(capabilityReport.limits.maxDocumentBytes) &&
    capabilityReport.limits.maxDocumentBytes > 0
  );
}

function serializedDocumentBytes(document) {
  try {
    const serialized = JSON.stringify(document);
    return typeof serialized === "string"
      ? new TextEncoder().encode(serialized).byteLength
      : null;
  } catch {
    return null;
  }
}

export function decideLocalPreviewDraftDelivery({
  capabilityReport,
  document,
  negotiation,
} = {}) {
  if (!isRecord(negotiation)) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        code: "preview.invalidNegotiation",
        message: "Local Preview negotiation state is missing or malformed.",
        recoveryMessage:
          "Renegotiate a supported Local Preview subprotocol before sending a draft.",
      }),
    };
  }
  if (negotiation.ok !== true) {
    return {
      delivery: "withhold",
      diagnostic: isRecord(negotiation.diagnostic)
        ? negotiation.diagnostic
        : structuredDeliveryDiagnostic({
            code: "preview.invalidNegotiation",
            message: "Local Preview negotiation did not select a version.",
            recoveryMessage:
              "Renegotiate a supported Local Preview subprotocol before sending a draft.",
          }),
    };
  }
  if (
    !isRecord(document) ||
    typeof document.schemaVersion !== "string" ||
    !isRecord(document.compatibility) ||
    !Array.isArray(document.compatibility.requiredCapabilities)
  ) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        action: "editProperty",
        code: "preview.invalidDraft",
        message: "The preview draft is missing its version or capability contract.",
        recoveryMessage: "Validate the complete draft before preview delivery.",
      }),
    };
  }
  if (negotiation.selectedVersion !== document.schemaVersion) {
    return {
      delivery: "withhold",
      diagnostic: incompatibleSchemaDiagnostic(),
    };
  }
  if (!isWellFormedCapabilityReport(capabilityReport)) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        code: "preview.invalidCapabilityReport",
        message: "The preview client's capability report is missing or malformed.",
        recoveryMessage:
          "Reconnect or update the preview client so it sends a complete capability report.",
      }),
    };
  }
  if (!capabilityReport.supportedSchemaVersions.includes(document.schemaVersion)) {
    return {
      delivery: "withhold",
      diagnostic: incompatibleSchemaDiagnostic(),
    };
  }
  const previewCapabilities = new Map(
    capabilityReport.previewCapabilities.map(({ name, version }) => [
      name,
      version,
    ]),
  );
  const missingPreviewCapabilities = requiredLocalPreviewV03Capabilities.filter(
    (name) => previewCapabilities.get(name) !== "0.3",
  );
  if (missingPreviewCapabilities.length > 0) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        code: "preview.unsupportedPreviewCapability",
        message:
          "The preview client does not support every required Local Preview capability at version 0.3.",
        recoveryMessage: `Update the preview client to support: ${missingPreviewCapabilities.join(", ")}@0.3.`,
      }),
    };
  }
  const supported = new Map(
    capabilityReport.supportedCapabilities.map(({ name, version }) => [
      name,
      version,
    ]),
  );
  const missingCapabilities = document.compatibility.requiredCapabilities
    .filter(({ name, version }) => supported.get(name) !== version)
    .map(({ name }) => name);
  if (missingCapabilities.length > 0) {
    return {
      delivery: "withhold",
      diagnostic: {
        code: "preview.unsupportedCapability",
        message:
          "The preview client does not support every capability required by this draft.",
        fallback: "keepLastAcceptedDraft",
        recovery: {
          action: "updatePreviewClient",
          message: `Update the preview client to support: ${missingCapabilities.join(", ")}.`,
        },
      },
    };
  }
  const documentBytes = serializedDocumentBytes(document);
  if (documentBytes === null) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        action: "editProperty",
        code: "preview.invalidDraft",
        message: "The preview draft cannot be serialized safely.",
        recoveryMessage: "Validate and serialize the draft before preview delivery.",
      }),
    };
  }
  if (documentBytes > capabilityReport.limits.maxDocumentBytes) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        action: "removeComponent",
        code: "preview.documentTooLarge",
        message:
          "The serialized preview draft exceeds the client's document byte limit.",
        recoveryMessage:
          "Reduce the draft size or use a preview client with a larger document limit.",
      }),
    };
  }
  return { delivery: "send" };
}

function formatErrors(label, validationErrors = []) {
  return validationErrors.map(
    (error) =>
      `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}

function revisionKey(payload) {
  return (
    `${payload.editableDocumentId}:` +
    `${payload.revision.sequence}:${payload.revision.revisionId}`
  );
}

function validateFixtureFlow(errors, artifacts) {
  const messageTypes = new Set(
    artifacts.previewMessageSchema.properties.type.enum,
  );
  const seenTypes = new Set();
  const seenIds = new Set();
  const sessions = new Set();
  const drafts = new Map();
  const validationEvents = new Set();
  const renderFailures = new Set();
  let invalidDraftCount = 0;

  for (const message of artifacts.messages) {
    seenTypes.add(message.type);
    sessions.add(message.sessionId);
    if (seenIds.has(message.messageId)) {
      errors.push(`Local Preview 0.3 repeats message ID ${message.messageId}`);
    }
    seenIds.add(message.messageId);
    if (message.previewProtocolVersion !== "0.3") {
      errors.push(`${message.messageId} does not use Local Preview 0.3`);
    }
    if (message.type === "draftUpdated") {
      const key = revisionKey(message.payload);
      drafts.set(key, message.payload.document);
      const documentErrors = validateProtocolV03({
        ...artifacts,
        document: message.payload.document,
      });
      if (documentErrors.length > 0) invalidDraftCount += 1;
    } else if (message.type === "validationError") {
      validationEvents.add(revisionKey(message.payload));
    } else if (message.type === "renderFailure") {
      renderFailures.add(revisionKey(message.payload));
    } else if (message.type === "capabilityReport") {
      if (
        JSON.stringify(message.payload.supportedSchemaVersions) !==
        JSON.stringify(["0.3"])
      ) {
        errors.push(
          "Local Preview capability report must advertise 0.3 support",
        );
      }
      const supported = new Map(
        message.payload.supportedCapabilities.map((capability) => [
          capability.name,
          capability.version,
        ]),
      );
      for (const capability of artifacts.manifest.capabilities) {
        if (supported.get(capability.name) !== "0.3") {
          errors.push(
            `Local Preview 0.3 capability report omits ${capability.name}@0.3`,
          );
        }
      }
      if (
        message.payload.previewCapabilities.some(
          (capability) => capability.version !== "0.3",
        )
      ) {
        errors.push("Local Preview 0.3 preview capabilities must use version 0.3");
      }
    } else if (message.type === "mockCommerceStateChanged") {
      errors.push(
        ...validateMockCommerceState(
          artifacts.localProject.document,
          message.payload.state,
        ).map((error) => `Local Preview 0.3 mock commerce: ${error}`),
      );
    }
  }

  for (const required of messageTypes) {
    if (!seenTypes.has(required)) {
      errors.push(`Local Preview 0.3 fixture omits message type ${required}`);
    }
  }
  if (sessions.size !== 1) {
    errors.push("Local Preview 0.3 fixture must use exactly one session");
  }
  if (invalidDraftCount !== 1) {
    errors.push("Local Preview 0.3 must contain exactly one invalid draft update");
  }

  for (const message of artifacts.messages) {
    if (message.type !== "draftAccepted" && message.type !== "draftRejected") {
      continue;
    }
    const key = revisionKey(message.payload);
    const document = drafts.get(key);
    if (!document) {
      errors.push(`${message.type} references an unknown Local Preview 0.3 draft`);
      continue;
    }
    const documentErrors = validateProtocolV03({ ...artifacts, document });
    if (message.type === "draftAccepted" && documentErrors.length > 0) {
      errors.push("Local Preview 0.3 accepts an invalid draft");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "validationFailed" &&
      (documentErrors.length === 0 || !validationEvents.has(key))
    ) {
      errors.push("Local Preview 0.3 validation rejection is not correlated");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "renderFailed" &&
      !renderFailures.has(key)
    ) {
      errors.push("Local Preview 0.3 render rejection is not correlated");
    }
  }
}

function validateRuntimeReset(errors, artifacts) {
  const resetFixture = artifacts.acceptedRevisionRuntimeReset;
  const acceptedMessage = artifacts.messages.find(
    (message) =>
      message.type === "draftAccepted" &&
      message.payload.revision.sequence === resetFixture.acceptedRevision.sequence,
  );
  const acceptedDraft = artifacts.messages.find(
    (message) =>
      message.type === "draftUpdated" &&
      acceptedMessage &&
      revisionKey(message.payload) === revisionKey(acceptedMessage.payload),
  );
  if (!acceptedDraft) {
    errors.push("Local Preview 0.3 runtime-reset fixture references no accepted draft");
    return;
  }
  const expectedReset = runtimeStateForAcceptedV03Revision(
    acceptedDraft.payload.document,
  );
  if (
    JSON.stringify(expectedReset) !==
    JSON.stringify(resetFixture.expectedRuntimeAfterAcceptance)
  ) {
    errors.push(
      "Accepted Local Preview 0.3 revisions must reset Switch, Carousel, navigation, and Product Card selection runtime state",
    );
  }
  if (
    JSON.stringify(resetFixture.runtimeBeforeAcceptance) ===
    JSON.stringify(resetFixture.expectedRuntimeAfterAcceptance)
  ) {
    errors.push("Local Preview 0.3 runtime-reset fixture does not exercise changed state");
  }
}

function sameSet(left, right) {
  return (
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

function validateLocalPreviewManifest(errors, artifacts, validators) {
  const manifest = artifacts.localPreviewManifest;
  if (!validators.localPreviewManifest(manifest)) {
    errors.push(
      ...formatErrors(
        "Local Preview 0.3 compatibility manifest",
        validators.localPreviewManifest.errors,
      ),
    );
    return;
  }
  if (
    !sameSet(
      manifest.messageTypes,
      artifacts.previewMessageSchema.properties.type.enum,
    )
  ) {
    errors.push(
      "Local Preview 0.3 manifest message taxonomy does not equal the preview-message schema",
    );
  }
  if (
    !sameSet(
      manifest.previewCapabilities.map((capability) => capability.name),
      requiredLocalPreviewV03Capabilities,
    )
  ) {
    errors.push(
      "Local Preview 0.3 manifest capability set does not equal the preview-message schema",
    );
  }
  if (
    !sameSet(
      manifest.deliveryDiagnosticCodes,
      localPreviewV03DeliveryDiagnosticCodes,
    )
  ) {
    errors.push(
      "Local Preview 0.3 manifest diagnostic codes do not equal the draft-delivery decision codes",
    );
  }
  const manifestDirectory = dirname(previewV03Paths.compatibilityManifest);
  for (const path of [
    manifest.documentProtocol.compatibilityManifest,
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Local Preview 0.3 manifest path does not exist: ${path}`);
    }
  }
}

export function validatePreviewV03Artifacts(
  artifacts = loadPreviewV03Artifacts(),
) {
  const validators = schemaValidators(artifacts);
  const errors = [];
  validateLocalPreviewManifest(errors, artifacts, validators);
  for (const [index, message] of artifacts.messages.entries()) {
    if (!validators.message(message)) {
      errors.push(...formatErrors(`v0.3 messages/${index}`, validators.message.errors));
    }
  }
  if (!validators.localProject(artifacts.localProject)) {
    errors.push(
      ...formatErrors("v0.3 localProject", validators.localProject.errors),
    );
  }
  if (errors.length > 0) return errors;

  errors.push(
    ...validateProtocolV03({
      ...artifacts,
      document: artifacts.localProject.document,
    }).map((error) => `v0.3 local project document: ${error}`),
  );
  errors.push(
    ...validateMockCommerceState(
      artifacts.localProject.document,
      artifacts.localProject.mockCommerce.state,
    ),
  );
  validateFixtureFlow(errors, artifacts);
  validateRuntimeReset(errors, artifacts);
  return errors;
}

export function validatePreviewV03JsonFormatting() {
  const errors = [];
  for (const filePath of Object.values(previewV03Paths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    if (source !== `${JSON.stringify(parsed, null, 2)}\n`) {
      errors.push(`${relative(previewV03Root, filePath)} is not canonical JSON`);
    }
  }
  return errors;
}
