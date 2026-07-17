import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocalPreviewFixtures } from "./generate-local-preview-fixtures.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const sourceSchemaDirectory = resolve(
  protocolRoot,
  "schema/local-preview/v0.1",
);
const targetSchemaDirectory = resolve(
  protocolRoot,
  "schema/local-preview/v0.2",
);
const targetFixtureDirectory = resolve(
  protocolRoot,
  "fixtures/local-preview/v0.2",
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function upgradeSchemaValue(value) {
  if (Array.isArray(value)) return value.map(upgradeSchemaValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, upgradeSchemaValue(entry)]),
    );
  }
  if (value === "0.1") return "0.2";
  if (typeof value === "string") {
    return value
      .replaceAll("local-preview:v0.1", "local-preview:v0.2")
      .replaceAll("schema:v0.1:paywall", "schema:v0.2:paywall")
      .replaceAll("Preview Message 0.1", "Preview Message 0.2")
      .replaceAll("Project File 0.1", "Project File 0.2");
  }
  return value;
}

function walk(node, visitor, path = "/layout") {
  visitor(node, path);
  if (node?.type === "scrollContainer") {
    walk(node.content, visitor, `${path}/content`);
  } else if (node?.type === "stack") {
    node.children.forEach((child, index) =>
      walk(child, visitor, `${path}/children/${index}`),
    );
  } else if (node?.type === "carousel") {
    node.pages.forEach((page, index) =>
      walk(page.content, visitor, `${path}/pages/${index}/content`),
    );
  }
}

function findNode(document, id) {
  let found = null;
  walk(document.layout, (node, path) => {
    if (node.id === id) found = { node, path };
  });
  if (!found) throw new Error(`Expected Protocol 0.2 fixture node ${id}.`);
  return found;
}

function incompatibleClientSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:mosaic:protocol:schema:local-preview:v0.2:incompatible-client",
    title: "Mosaic Local Preview 0.2 Incompatible Client Decision",
    type: "object",
    additionalProperties: false,
    required: [
      "studioSupportedPreviewVersions",
      "clientSupportedPreviewVersions",
      "selectedPreviewVersion",
      "selectedWebSocketSubprotocol",
      "draftSchemaVersion",
      "delivery",
      "diagnostic",
    ],
    properties: {
      studioSupportedPreviewVersions: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: ["0.1", "0.2"] },
      },
      clientSupportedPreviewVersions: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: ["0.1", "0.2"] },
      },
      selectedPreviewVersion: { const: "0.1" },
      selectedWebSocketSubprotocol: {
        const: "mosaic.local-preview.v0.1",
      },
      draftSchemaVersion: { const: "0.2" },
      delivery: { const: "withhold" },
      diagnostic: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "fallback", "recovery"],
        properties: {
          code: { const: "preview.incompatibleSchemaVersion" },
          message: { type: "string", minLength: 1, maxLength: 512 },
          fallback: { const: "keepLastAcceptedDraft" },
          recovery: {
            type: "object",
            additionalProperties: false,
            required: ["action", "message"],
            properties: {
              action: { const: "updatePreviewClient" },
              message: { type: "string", minLength: 1, maxLength: 512 },
            },
          },
        },
      },
    },
  };
}

function incompatibleV01ClientFixture() {
  return {
    studioSupportedPreviewVersions: ["0.1", "0.2"],
    clientSupportedPreviewVersions: ["0.1"],
    selectedPreviewVersion: "0.1",
    selectedWebSocketSubprotocol: "mosaic.local-preview.v0.1",
    draftSchemaVersion: "0.2",
    delivery: "withhold",
    diagnostic: {
      code: "preview.incompatibleSchemaVersion",
      message:
        "This Local Preview 0.1 client cannot receive a Protocol 0.2 draft.",
      fallback: "keepLastAcceptedDraft",
      recovery: {
        action: "updatePreviewClient",
        message:
          "Update the preview client to a version that supports Local Preview and Protocol 0.2.",
      },
    },
  };
}

function acceptedRevisionRuntimeResetFixture(document) {
  const switches = {};
  const carousels = {};
  walk(document.layout, (node) => {
    if (node.type === "switch") switches[node.id] = node.initialValue;
    if (node.type === "carousel") {
      carousels[node.id] = node.initialPageIndex;
    }
  });
  return {
    acceptedRevision: {
      editableDocumentId: "document_phase2_demo",
      revisionId: "revision_000002",
      sequence: 2,
    },
    runtimeBeforeAcceptance: {
      switches: Object.fromEntries(
        Object.entries(switches).map(([id, value]) => [id, !value]),
      ),
      carousels: Object.fromEntries(
        Object.entries(carousels).map(([id]) => [id, 0]),
      ),
    },
    expectedRuntimeAfterAcceptance: { switches, carousels },
  };
}

export function buildLocalPreviewV02Contract() {
  const previewMessageSchema = upgradeSchemaValue(
    readJson(resolve(sourceSchemaDirectory, "preview-message.schema.json")),
  );
  const localProjectSchema = upgradeSchemaValue(
    readJson(resolve(sourceSchemaDirectory, "local-project.schema.json")),
  );
  const document = readJson(
    resolve(protocolRoot, "fixtures/v0.2/complete-paywall.json"),
  );
  const manifest = readJson(resolve(protocolRoot, "compatibility/v0.2.json"));
  const base = buildLocalPreviewFixtures();
  const invalidDocument = structuredClone(document);
  const selector = findNode(invalidDocument, "plans");
  selector.node.productReferenceIds[0] = "missing-plan";

  const messages = base.messages.map((message) => {
    const upgraded = structuredClone(message);
    upgraded.previewProtocolVersion = "0.2";
    if (upgraded.type === "previewClientConnected") {
      upgraded.payload.client.renderer.version = "0.2.0";
    }
    if (upgraded.type === "capabilityReport") {
      upgraded.payload.supportedSchemaVersions = ["0.1", "0.2"];
      upgraded.payload.supportedCapabilities = manifest.capabilities.map(
        ({ name, version }) => ({ name, version }),
      );
      upgraded.payload.previewCapabilities =
        upgraded.payload.previewCapabilities.map((capability) => ({
          ...capability,
          version: "0.2",
        }));
    }
    if (upgraded.type === "draftUpdated") {
      upgraded.payload.document =
        upgraded.messageId === "msg_000009"
          ? invalidDocument
          : structuredClone(document);
    }
    const source = JSON.stringify(upgraded);
    return JSON.parse(
      source.replaceAll(
        "/layout/content/children/5/productReferenceIds/0",
        `${selector.path}/productReferenceIds/0`,
      ),
    );
  });

  const localProject = structuredClone(base.localProject);
  localProject.fileFormatVersion = "0.2";
  localProject.document = document;

  return {
    acceptedRevisionRuntimeReset:
      acceptedRevisionRuntimeResetFixture(document),
    incompatibleClient: incompatibleV01ClientFixture(),
    incompatibleClientSchema: incompatibleClientSchema(),
    localProject,
    localProjectSchema,
    messages,
    previewMessageSchema,
  };
}

export function writeLocalPreviewV02Contract() {
  const contract = buildLocalPreviewV02Contract();
  mkdirSync(targetSchemaDirectory, { recursive: true });
  mkdirSync(targetFixtureDirectory, { recursive: true });
  const files = {
    [resolve(targetSchemaDirectory, "preview-message.schema.json")]:
      contract.previewMessageSchema,
    [resolve(targetSchemaDirectory, "local-project.schema.json")]:
      contract.localProjectSchema,
    [resolve(targetFixtureDirectory, "session-flow.messages.json")]:
      contract.messages,
    [resolve(targetFixtureDirectory, "local-project.json")]:
      contract.localProject,
    [resolve(targetFixtureDirectory, "incompatible-v0.1-client.json")]:
      contract.incompatibleClient,
    [resolve(targetFixtureDirectory, "accepted-revision-runtime-reset.json")]:
      contract.acceptedRevisionRuntimeReset,
    [resolve(targetSchemaDirectory, "incompatible-client.schema.json")]:
      contract.incompatibleClientSchema,
  };
  for (const [path, value] of Object.entries(files)) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeLocalPreviewV02Contract();
}
