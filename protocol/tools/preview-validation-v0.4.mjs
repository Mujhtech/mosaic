import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { localPreviewV03DeliveryDiagnosticCodes } from "./preview-validation-v0.3.mjs";
import {
  loadProtocolV04Artifacts,
  runtimeStateForAcceptedV04Revision,
  validateProtocolV04,
} from "./validation-v0.4.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const previewV04Root = resolve(toolsDirectory, "..");

export const previewV04Paths = Object.freeze({
  acceptedRevisionRuntimeResetFixture: resolve(
    previewV04Root,
    "fixtures/local-preview/v0.4/accepted-revision-runtime-reset.json",
  ),
  localProjectFixture: resolve(
    previewV04Root,
    "fixtures/local-preview/v0.4/local-project.json",
  ),
  messageFixture: resolve(
    previewV04Root,
    "fixtures/local-preview/v0.4/session-flow.messages.json",
  ),
  localProjectSchema: resolve(
    previewV04Root,
    "schema/local-preview/v0.4/local-project.schema.json",
  ),
  previewMessageSchema: resolve(
    previewV04Root,
    "schema/local-preview/v0.4/preview-message.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    previewV04Root,
    "schema/local-preview/v0.4/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    previewV04Root,
    "compatibility/local-preview/v0.4.json",
  ),
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadPreviewV04Artifacts() {
  return {
    ...loadProtocolV04Artifacts(),
    acceptedRevisionRuntimeReset: readJson(
      previewV04Paths.acceptedRevisionRuntimeResetFixture,
    ),
    localProject: readJson(previewV04Paths.localProjectFixture),
    localProjectSchema: readJson(previewV04Paths.localProjectSchema),
    messages: readJson(previewV04Paths.messageFixture),
    previewMessageSchema: readJson(previewV04Paths.previewMessageSchema),
    localPreviewManifestSchema: readJson(
      previewV04Paths.compatibilityManifestSchema,
    ),
    localPreviewManifest: readJson(previewV04Paths.compatibilityManifest),
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

export const localPreviewV04VersionPreference = Object.freeze(["0.4"]);

/**
 * The delivery diagnostic vocabulary is unchanged by 0.4.
 *
 * Aliased rather than copied. Two identical lists in two files is exactly the
 * drift this repository has already been bitten by: each stays internally
 * consistent while the pair stops agreeing. If 0.4 ever needs a code 0.3 does
 * not have, this becomes a real list and the divergence is deliberate.
 */
export const localPreviewV04DeliveryDiagnosticCodes =
  localPreviewV03DeliveryDiagnosticCodes;

export const requiredLocalPreviewV04Capabilities = Object.freeze([
  ...readJson(previewV04Paths.previewMessageSchema).$defs.previewCapabilityName
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
      errors.push(`Local Preview 0.4 repeats message ID ${message.messageId}`);
    }
    seenIds.add(message.messageId);
    if (message.previewProtocolVersion !== "0.4") {
      errors.push(`${message.messageId} does not use Local Preview 0.4`);
    }
    if (message.type === "draftUpdated") {
      const key = revisionKey(message.payload);
      drafts.set(key, message.payload.document);
      const documentErrors = validateProtocolV04({
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
        JSON.stringify(["0.4"])
      ) {
        errors.push(
          "Local Preview capability report must advertise 0.4 support",
        );
      }
      const supported = new Map(
        message.payload.supportedCapabilities.map((capability) => [
          capability.name,
          capability.version,
        ]),
      );
      for (const capability of artifacts.manifest.capabilities) {
        if (supported.get(capability.name) !== "0.4") {
          errors.push(
            `Local Preview 0.4 capability report omits ${capability.name}@0.4`,
          );
        }
      }
      // 0.4 removed style.productCardStates. A client still advertising it is
      // reporting a capability no 0.4 document can require, and the paywall
      // validator's unused-capability rule would never see it: the report is
      // not the document.
      for (const name of supported.keys()) {
        if (
          artifacts.manifest.capabilities.some(
            (capability) => capability.name === name,
          )
        ) {
          continue;
        }
        errors.push(
          `Local Preview 0.4 capability report declares unknown capability ${name}`,
        );
      }
      if (
        message.payload.previewCapabilities.some(
          (capability) => capability.version !== "0.4",
        )
      ) {
        errors.push(
          "Local Preview 0.4 preview capabilities must use version 0.4",
        );
      }
    } else if (message.type === "mockCommerceStateChanged") {
      errors.push(
        ...validateMockCommerceState(
          artifacts.localProject.document,
          message.payload.state,
        ).map((error) => `Local Preview 0.4 mock commerce: ${error}`),
      );
    }
  }

  for (const required of messageTypes) {
    if (!seenTypes.has(required)) {
      errors.push(`Local Preview 0.4 fixture omits message type ${required}`);
    }
  }
  if (sessions.size !== 1) {
    errors.push("Local Preview 0.4 fixture must use exactly one session");
  }
  if (invalidDraftCount !== 1) {
    errors.push(
      "Local Preview 0.4 must contain exactly one invalid draft update",
    );
  }

  for (const message of artifacts.messages) {
    if (message.type !== "draftAccepted" && message.type !== "draftRejected") {
      continue;
    }
    const key = revisionKey(message.payload);
    const document = drafts.get(key);
    if (!document) {
      errors.push(
        `${message.type} references an unknown Local Preview 0.4 draft`,
      );
      continue;
    }
    const documentErrors = validateProtocolV04({ ...artifacts, document });
    if (message.type === "draftAccepted" && documentErrors.length > 0) {
      errors.push("Local Preview 0.4 accepts an invalid draft");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "validationFailed" &&
      (documentErrors.length === 0 || !validationEvents.has(key))
    ) {
      errors.push("Local Preview 0.4 validation rejection is not correlated");
    }
    if (
      message.type === "draftRejected" &&
      message.payload.reason === "renderFailed" &&
      !renderFailures.has(key)
    ) {
      errors.push("Local Preview 0.4 render rejection is not correlated");
    }
  }
}

function acceptedDraftDocument(artifacts) {
  const resetFixture = artifacts.acceptedRevisionRuntimeReset;
  const acceptedMessage = artifacts.messages.find(
    (message) =>
      message.type === "draftAccepted" &&
      message.payload.revision.sequence ===
        resetFixture.acceptedRevision.sequence,
  );
  const acceptedDraft = artifacts.messages.find(
    (message) =>
      message.type === "draftUpdated" &&
      acceptedMessage &&
      revisionKey(message.payload) === revisionKey(acceptedMessage.payload),
  );
  return acceptedDraft?.payload.document ?? null;
}

function validateRuntimeReset(errors, artifacts) {
  const resetFixture = artifacts.acceptedRevisionRuntimeReset;
  const document = acceptedDraftDocument(artifacts);
  if (!document) {
    errors.push(
      "Local Preview 0.4 runtime-reset fixture references no accepted draft",
    );
    return;
  }

  const expectedReset = runtimeStateForAcceptedV04Revision(
    document,
    resetFixture.runtimeBeforeAcceptance,
  );
  if (
    JSON.stringify(expectedReset) !==
    JSON.stringify(resetFixture.expectedRuntimeAfterAcceptance)
  ) {
    errors.push(
      "Accepted Local Preview 0.4 revisions must reset Switch, Carousel, navigation, and " +
        "Product Card selection runtime state while retaining played appear screens",
    );
  }
  if (
    JSON.stringify(resetFixture.runtimeBeforeAcceptance) ===
    JSON.stringify(resetFixture.expectedRuntimeAfterAcceptance)
  ) {
    errors.push(
      "Local Preview 0.4 runtime-reset fixture does not exercise changed state",
    );
  }

  const firstAccepted = runtimeStateForAcceptedV04Revision(document);
  if (
    JSON.stringify(firstAccepted) !==
    JSON.stringify(resetFixture.expectedRuntimeForFirstAcceptedRevision)
  ) {
    errors.push(
      "The first accepted Local Preview 0.4 revision of a session must play every entrance",
    );
  }
  if (firstAccepted.motion.playedAppearScreens.length !== 0) {
    errors.push(
      "Local Preview 0.4 must record no played appear screen before one has appeared",
    );
  }

  // A suppression rule that no fixture exercises is a rule that passes because
  // nothing reaches it. Both halves are asserted: a screen the new revision
  // still declares survives the acceptance, and a screen it no longer declares
  // does not.
  const declaredScreens = new Set(document.screens.map((screen) => screen.id));
  const before = resetFixture.runtimeBeforeAcceptance.motion.playedAppearScreens;
  const after =
    resetFixture.expectedRuntimeAfterAcceptance.motion.playedAppearScreens;
  if (!before.some((screenId) => declaredScreens.has(screenId))) {
    errors.push(
      "Local Preview 0.4 runtime-reset fixture never exercises entrance-replay suppression",
    );
  }
  if (!before.some((screenId) => !declaredScreens.has(screenId))) {
    errors.push(
      "Local Preview 0.4 runtime-reset fixture never exercises a played screen the revision removed",
    );
  }
  if (after.length === 0) {
    errors.push(
      "Local Preview 0.4 acceptance must retain the appear screens it still declares",
    );
  }
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function validateLocalPreviewManifest(errors, artifacts, validators) {
  const manifest = artifacts.localPreviewManifest;
  if (!validators.localPreviewManifest(manifest)) {
    errors.push(
      ...formatErrors(
        "Local Preview 0.4 compatibility manifest",
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
      "Local Preview 0.4 manifest message taxonomy does not equal the preview-message schema",
    );
  }
  if (
    !sameSet(
      manifest.previewCapabilities.map((capability) => capability.name),
      requiredLocalPreviewV04Capabilities,
    )
  ) {
    errors.push(
      "Local Preview 0.4 manifest capability set does not equal the preview-message schema",
    );
  }
  if (
    !sameSet(
      manifest.deliveryDiagnosticCodes,
      localPreviewV04DeliveryDiagnosticCodes,
    )
  ) {
    errors.push(
      "Local Preview 0.4 manifest diagnostic codes do not equal the draft-delivery decision codes",
    );
  }
  if (manifest.status !== "draft") {
    errors.push(
      "Local Preview 0.4 is a draft and its manifest must say so until the owner rules otherwise",
    );
  }
  const manifestDirectory = dirname(previewV04Paths.compatibilityManifest);
  for (const path of [
    manifest.documentProtocol.compatibilityManifest,
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Local Preview 0.4 manifest path does not exist: ${path}`);
    }
  }
}

export function validatePreviewV04Artifacts(
  artifacts = loadPreviewV04Artifacts(),
) {
  const validators = schemaValidators(artifacts);
  const errors = [];
  validateLocalPreviewManifest(errors, artifacts, validators);
  for (const [index, message] of artifacts.messages.entries()) {
    if (!validators.message(message)) {
      errors.push(
        ...formatErrors(`v0.4 messages/${index}`, validators.message.errors),
      );
    }
  }
  if (!validators.localProject(artifacts.localProject)) {
    errors.push(
      ...formatErrors("v0.4 localProject", validators.localProject.errors),
    );
  }
  if (errors.length > 0) return errors;

  errors.push(
    ...validateProtocolV04({
      ...artifacts,
      document: artifacts.localProject.document,
    }).map((error) => `v0.4 local project document: ${error}`),
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

export function validatePreviewV04JsonFormatting() {
  const errors = [];
  for (const filePath of Object.values(previewV04Paths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    if (source !== `${JSON.stringify(parsed, null, 2)}\n`) {
      errors.push(`${relative(previewV04Root, filePath)} is not canonical JSON`);
    }
  }
  return errors;
}
