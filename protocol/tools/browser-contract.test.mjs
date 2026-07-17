import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSchemas,
  localPreviewContractVersion,
  localPreviewWebSocketProtocol,
  parsePortablePaywallJson,
  previewMessageTypes,
  requiredPreviewCapabilities,
  serializePortablePaywallJson,
  validateLocalProject,
  validatePaywallDocument,
  validatePreviewMessage,
} from "../browser/index.js";
import { validateBrowserContractGeneration } from "./browser-contract-validation.mjs";
import { loadPreviewArtifacts } from "./preview-validation.mjs";
import {
  loadProtocolArtifacts,
  validateProtocol,
  walkDocumentNodes,
} from "./validation.mjs";

function previewArtifacts() {
  return structuredClone(loadPreviewArtifacts());
}

function paywallArtifacts() {
  return structuredClone(loadProtocolArtifacts());
}

function node(document, id) {
  const result = walkDocumentNodes(document).find((entry) => entry.id === id);
  assert.ok(result, `expected canonical node ${id}`);
  return result;
}

function nodeValidatorAccepts(document, input) {
  return (
    validateProtocol({
      document,
      manifest: input.manifest,
      manifestSchema: input.manifestSchema,
      paywallSchema: input.paywallSchema,
    }).length === 0
  );
}

test("the browser contract declarations are generated from canonical schemas", () => {
  assert.deepEqual(validateBrowserContractGeneration(), []);
});

test("browser constants are derived from the frozen Local Preview schemas", () => {
  const input = previewArtifacts();

  assert.equal(localPreviewContractVersion, "0.1");
  assert.equal(localPreviewWebSocketProtocol, "mosaic.local-preview.v0.1");
  assert.deepEqual(
    previewMessageTypes,
    input.previewMessageSchema.properties.type.enum,
  );
  assert.deepEqual(
    requiredPreviewCapabilities,
    input.previewMessageSchema.$defs.previewCapabilityName.enum,
  );
  assert.equal(canonicalSchemas.paywall.$id, input.paywallSchema.$id);
  assert.equal(
    canonicalSchemas.previewMessage.$id,
    input.previewMessageSchema.$id,
  );
  assert.equal(
    canonicalSchemas.localProject.$id,
    input.localProjectSchema.$id,
  );
  assert.equal(Object.isFrozen(previewMessageTypes), true);
  assert.equal(Object.isFrozen(requiredPreviewCapabilities), true);
  assert.equal(Object.isFrozen(canonicalSchemas), true);
});

test("canonical paywall and local-project fixtures pass browser validation", () => {
  const input = previewArtifacts();

  assert.deepEqual(validatePaywallDocument(input.document), {
    ok: true,
    value: input.document,
    diagnostics: [],
  });
  assert.deepEqual(validateLocalProject(input.localProject), {
    ok: true,
    value: input.localProject,
    diagnostics: [],
  });
});

test("the browser validator accepts every valid fixture message", () => {
  const input = previewArtifacts();
  const rejectedMessageIds = input.messages
    .filter(
      (message) =>
        !validatePreviewMessage(message, { document: input.document }).ok,
    )
    .map((message) => message.messageId);

  assert.deepEqual(rejectedMessageIds, ["msg_000009"]);
});

test("browser preview validation preserves regex-only timestamp semantics", () => {
  const input = previewArtifacts();
  const heartbeat = input.messages.find(
    (message) => message.type === "previewHeartbeat",
  );
  assert.ok(heartbeat);
  heartbeat.sentAt = "2026-07-17T99:00:00Z";

  assert.equal(validatePreviewMessage(heartbeat).ok, true);
});

test("the intentionally invalid fixture draft reports its product binding", () => {
  const input = previewArtifacts();
  const update = input.messages.find(
    (message) => message.messageId === "msg_000009",
  );
  assert.ok(update);

  const result = validatePreviewMessage(update);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (entry) =>
        entry.code === "semantic.invalidReference" &&
        entry.location.documentPath ===
          "/layout/content/children/5/productReferenceIds/0" &&
        entry.location.componentId === "plans" &&
        entry.location.property === "productReferenceIds" &&
        entry.recovery.action === "bindProduct",
    ),
  );
});

test("browser and Node validators agree on schema and semantic mutations", () => {
  const mutations = [
    {
      name: "valid localized headline edit",
      mutate(document) {
        node(document, "headline").value.default = "Build one native paywall";
        document.localization.locales.en.strings["paywall.headline"] =
          "Build one native paywall";
      },
    },
    {
      name: "unknown root property",
      mutate(document) {
        document.remoteCode = "never";
      },
    },
    {
      name: "duplicate component identifier",
      mutate(document) {
        node(document, "subtitle").id = "headline";
      },
    },
    {
      name: "duplicate feature identifier",
      mutate(document) {
        node(document, "features").items[1].id = "unlimited-projects";
      },
    },
    {
      name: "unknown asset reference",
      mutate(document) {
        node(document, "hero").assetId = "missing-asset";
      },
    },
    {
      name: "unused asset declaration",
      mutate(document) {
        const asset = structuredClone(document.assets[0]);
        asset.id = "unused-image";
        asset.source.key = "mosaic.paywall.unused";
        document.assets.push(asset);
      },
    },
    {
      name: "duplicate product reference identifier",
      mutate(document) {
        document.products[1].id = document.products[0].id;
      },
    },
    {
      name: "duplicate provider product identifier",
      mutate(document) {
        document.products[1].productId = document.products[0].productId;
      },
    },
    {
      name: "unknown product reference",
      mutate(document) {
        node(document, "plans").productReferenceIds[0] = "missing-plan";
      },
    },
    {
      name: "invalid initial product selection",
      mutate(document) {
        node(document, "plans").initiallySelectedProductReferenceId =
          "missing-plan";
      },
    },
    {
      name: "unknown product selector action",
      mutate(document) {
        node(document, "purchase").action.productSelectorId = "missing-plans";
      },
    },
    {
      name: "missing derived capability",
      mutate(document) {
        document.compatibility.requiredCapabilities =
          document.compatibility.requiredCapabilities.filter(
            (capability) => capability.name !== "component.text",
          );
      },
    },
    {
      name: "unused supported capabilities",
      mutate(document) {
        document.layout.content.children =
          document.layout.content.children.filter(
            (child) => child.id !== "close-actions",
          );
        for (const locale of Object.values(document.localization.locales)) {
          delete locale.strings["paywall.close"];
        }
      },
    },
    {
      name: "inline default and catalog mismatch",
      mutate(document) {
        node(document, "headline").value.default = "Mismatched headline";
      },
    },
    {
      name: "missing default localization key",
      mutate(document) {
        delete document.localization.locales.en.strings["paywall.headline"];
      },
    },
    {
      name: "unused default localization key",
      mutate(document) {
        document.localization.locales.en.strings["paywall.unused"] = "Unused";
      },
    },
    {
      name: "unknown translated localization key",
      mutate(document) {
        document.localization.locales.de.strings["paywall.unknown"] =
          "Unbekannt";
      },
    },
  ];

  for (const mutation of mutations) {
    const input = paywallArtifacts();
    mutation.mutate(input.document);
    assert.equal(
      validatePaywallDocument(input.document).ok,
      nodeValidatorAccepts(input.document, input),
      mutation.name,
    );
  }
});

test("browser diagnostics are structured, safe, and editor-addressable", () => {
  const input = paywallArtifacts();
  node(input.document, "plans").productReferenceIds[0] = "missing-plan";

  const result = validatePaywallDocument(input.document);
  assert.equal(result.ok, false);
  const binding = result.diagnostics.find(
    (entry) =>
      entry.location.componentId === "plans" &&
      entry.location.property === "productReferenceIds",
  );
  assert.ok(binding);
  assert.equal(binding.location.documentPath.endsWith("/0"), true);
  assert.equal(binding.recovery.action, "bindProduct");
  for (const entry of result.diagnostics) {
    assert.equal(entry.message.includes("\n"), false);
    assert.equal(entry.recovery.message.includes("\n"), false);
  }

  const preview = previewArtifacts();
  const validationEvent = preview.messages.find(
    (message) => message.type === "validationError",
  );
  assert.ok(validationEvent);
  validationEvent.payload.errors = result.diagnostics;
  assert.equal(validatePreviewMessage(validationEvent).ok, true);
});

test("preview messages reject unknown payload fields in the browser", () => {
  const input = previewArtifacts();
  const accepted = input.messages.find(
    (message) => message.type === "draftAccepted",
  );
  assert.ok(accepted);
  accepted.payload.platformWidget = "never";

  const result = validatePreviewMessage(accepted);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (entry) => entry.code === "schema.additionalProperties",
    ),
  );
});

test("local-project validation enforces mock product references", () => {
  const input = previewArtifacts();
  input.localProject.mockCommerce.state.products[0].productReferenceId =
    "missing-plan";

  const result = validateLocalProject(input.localProject);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (entry) =>
        entry.code === "semantic.invalidReference" &&
        entry.location.documentPath ===
          "/mockCommerce/state/products/0/productReferenceId",
    ),
  );
});

test("portable import accepts only valid raw paywall JSON", () => {
  const input = previewArtifacts();
  const rawPaywall = JSON.stringify(input.document);

  assert.equal(parsePortablePaywallJson(rawPaywall).ok, true);
  assert.equal(
    parsePortablePaywallJson(JSON.stringify(input.localProject)).ok,
    false,
  );

  const malformed = parsePortablePaywallJson("{not-json");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0].code, "validation.invalidJson");

  const oversized = parsePortablePaywallJson(rawPaywall, {
    maxDocumentBytes: 8,
  });
  assert.equal(oversized.ok, false);
  assert.equal(
    oversized.diagnostics[0].code,
    "validation.documentTooLarge",
  );
});

test("portable export is canonical and refuses invalid documents", () => {
  const input = paywallArtifacts();
  const valid = serializePortablePaywallJson(input.document);

  assert.equal(valid.ok, true);
  assert.equal(valid.value, `${JSON.stringify(input.document, null, 2)}\n`);

  node(input.document, "plans").productReferenceIds[0] = "missing-plan";
  const invalid = serializePortablePaywallJson(input.document);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.value, null);
});
