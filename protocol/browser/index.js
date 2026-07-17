import Ajv2020 from "ajv/dist/2020.js";

import compatibilityManifest from "../compatibility/v0.1.json" with { type: "json" };
import compatibilityManifestV02 from "../compatibility/v0.2.json" with { type: "json" };
import incompatibleClientSchemaV02 from "../schema/local-preview/v0.2/incompatible-client.schema.json" with { type: "json" };
import localProjectSchema from "../schema/local-preview/v0.1/local-project.schema.json" with { type: "json" };
import localProjectSchemaV02 from "../schema/local-preview/v0.2/local-project.schema.json" with { type: "json" };
import previewMessageSchema from "../schema/local-preview/v0.1/preview-message.schema.json" with { type: "json" };
import previewMessageSchemaV02 from "../schema/local-preview/v0.2/preview-message.schema.json" with { type: "json" };
import paywallSchema from "../schema/v0.1/paywall.schema.json" with { type: "json" };
import paywallSchemaV02 from "../schema/v0.2/paywall.schema.json" with { type: "json" };

export const localPreviewContractVersion =
  previewMessageSchema.properties.previewProtocolVersion.const;
export const localPreviewWebSocketProtocol =
  `mosaic.local-preview.v${localPreviewContractVersion}`;
export const localPreviewContractVersions = Object.freeze(["0.1", "0.2"]);
export const localPreviewVersionPreference = Object.freeze(["0.2", "0.1"]);
export const localPreviewWebSocketProtocols = Object.freeze({
  "0.1": "mosaic.local-preview.v0.1",
  "0.2": "mosaic.local-preview.v0.2",
});
export const previewMessageTypes = Object.freeze([
  ...previewMessageSchema.properties.type.enum,
]);
export const previewMessageTypesByVersion = Object.freeze({
  "0.1": previewMessageTypes,
  "0.2": Object.freeze([...previewMessageSchemaV02.properties.type.enum]),
});
export const requiredPreviewCapabilities = Object.freeze([
  ...previewMessageSchema.$defs.previewCapabilityName.enum,
]);
const requiredPreviewCapabilitiesV02 = Object.freeze([
  ...previewMessageSchemaV02.$defs.previewCapabilityName.enum,
]);
export const canonicalSchemas = Object.freeze({
  paywall: paywallSchema,
  previewMessage: previewMessageSchema,
  localProject: localProjectSchema,
});
export const canonicalSchemasByVersion = Object.freeze({
  "0.1": canonicalSchemas,
  "0.2": Object.freeze({
    paywall: paywallSchemaV02,
    previewMessage: previewMessageSchemaV02,
    localProject: localProjectSchemaV02,
    incompatibleClient: incompatibleClientSchemaV02,
  }),
});

function incompatibleSchemaVersionDiagnostic() {
  return {
    code: "preview.incompatibleSchemaVersion",
    message:
      "This Local Preview 0.1 client cannot receive a Protocol 0.2 draft.",
    fallback: "keepLastAcceptedDraft",
    recovery: {
      action: "updatePreviewClient",
      message:
        "Update the preview client to a version that supports Local Preview and Protocol 0.2.",
    },
  };
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
  const selectedVersion = localPreviewVersionPreference.find(
    (version) => local.has(version) && remote.has(version),
  );
  if (!selectedVersion) {
    return {
      ok: false,
      selectedVersion: null,
      selectedWebSocketSubprotocol: null,
      diagnostic: {
        code: "preview.noMutualVersion",
        message:
          "Studio and the preview client have no mutually supported Local Preview version.",
        fallback: "keepLastAcceptedDraft",
        recovery: {
          action: "updatePreviewClient",
          message:
            "Update Studio or the preview client to a mutually supported version.",
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
      diagnostic: incompatibleSchemaVersionDiagnostic(),
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
      diagnostic: incompatibleSchemaVersionDiagnostic(),
    };
  }
  const previewCapabilities = new Map(
    capabilityReport.previewCapabilities.map(({ name, version }) => [
      name,
      version,
    ]),
  );
  const missingPreviewCapabilities = requiredPreviewCapabilitiesV02.filter(
    (name) => previewCapabilities.get(name) !== "0.2",
  );
  if (missingPreviewCapabilities.length > 0) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        code: "preview.unsupportedPreviewCapability",
        message:
          "The preview client does not support every required Local Preview capability at version 0.2.",
        recoveryMessage: `Update the preview client to support: ${missingPreviewCapabilities.join(", ")}@0.2.`,
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

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(paywallSchema);
ajv.addSchema(paywallSchemaV02);
ajv.addSchema(previewMessageSchema);
ajv.addSchema(previewMessageSchemaV02);
const validatePaywallSchema = ajv.getSchema(paywallSchema.$id);
const validatePaywallSchemaV02 = ajv.getSchema(paywallSchemaV02.$id);
const validatePreviewMessageSchema = ajv.getSchema(previewMessageSchema.$id);
const validatePreviewMessageSchemaV02 = ajv.getSchema(
  previewMessageSchemaV02.$id,
);
const validateLocalProjectSchema = ajv.compile(localProjectSchema);
const validateLocalProjectSchemaV02 = ajv.compile(localProjectSchemaV02);

if (
  !validatePaywallSchema ||
  !validatePaywallSchemaV02 ||
  !validatePreviewMessageSchema ||
  !validatePreviewMessageSchemaV02
) {
  throw new Error("Canonical Mosaic schemas were not registered.");
}

const capabilityByType = Object.freeze({
  carousel: "component.carousel",
  closeButton: "component.closeButton",
  featureList: "component.featureList",
  image: "component.image",
  legalText: "component.legalText",
  productSelector: "component.productSelector",
  purchaseButton: "component.purchaseButton",
  restoreButton: "component.restoreButton",
  scrollContainer: "layout.scrollContainer",
  stack: "layout.stack",
  switch: "component.switch",
  text: "component.text",
  verticalStack: "layout.verticalStack",
  countdown: "component.countdown",
});

const colorFieldNames = new Set([
  "background",
  "color",
  "markerColor",
  "offTrackColor",
  "onTrackColor",
  "productLabelColor",
  "runtimePriceColor",
  "textColor",
  "thumbColor",
]);

const countdownUnitOrder = Object.freeze({
  day: 0,
  hour: 1,
  minute: 2,
  second: 3,
});

function success(value) {
  return { ok: true, value, diagnostics: [] };
}

function failure(diagnostics) {
  return { ok: false, value: null, diagnostics };
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendPointer(path, value) {
  return `${path}/${escapePointer(value)}`;
}

function pointerSegments(path) {
  if (!path) return [];
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function locationFor(value, documentPath, property, explicitComponentId) {
  let current = value;
  let componentId = explicitComponentId;

  for (const segment of pointerSegments(documentPath)) {
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      typeof current.id === "string"
    ) {
      componentId = current.id;
    }
    current = current?.[segment];
  }
  if (
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    typeof current.id === "string"
  ) {
    componentId = current.id;
  }

  return {
    documentPath,
    ...(componentId ? { componentId } : {}),
    ...(property ? { property } : {}),
  };
}

function diagnostic({
  code,
  message,
  documentPath = "",
  componentId,
  property,
  recoveryAction = "editProperty",
  recoveryMessage = "Correct the highlighted value and validate again.",
  document,
}) {
  return {
    code,
    message,
    location: locationFor(
      document,
      documentPath,
      property,
      componentId,
    ),
    recovery: {
      action: recoveryAction,
      message: recoveryMessage,
    },
  };
}

function schemaMessage(error) {
  switch (error.keyword) {
    case "required":
      return `Required property ${error.params.missingProperty} is missing.`;
    case "additionalProperties":
      return `Property ${error.params.additionalProperty} is not supported.`;
    case "type":
      return `Expected a value of type ${error.params.type}.`;
    case "const":
    case "enum":
      return "The value is not supported by this contract version.";
    case "minLength":
      return "The value is shorter than the minimum allowed length.";
    case "maxLength":
      return "The value exceeds the maximum allowed length.";
    case "minimum":
    case "exclusiveMinimum":
      return "The numeric value is below the allowed range.";
    case "maximum":
    case "exclusiveMaximum":
      return "The numeric value is above the allowed range.";
    case "pattern":
      return "The value does not use the required format.";
    case "uniqueItems":
      return "The list contains a duplicate value.";
    default:
      return "The value does not match the canonical Mosaic contract.";
  }
}

function schemaDiagnostics(validator, value) {
  if (validator(value)) return [];

  return (validator.errors ?? []).map((error) => {
    let documentPath = error.instancePath || "";
    let property;
    if (error.keyword === "required") {
      property = error.params.missingProperty;
      documentPath = appendPointer(documentPath, property);
    } else if (error.keyword === "additionalProperties") {
      property = error.params.additionalProperty;
      documentPath = appendPointer(documentPath, property);
    } else {
      const segments = pointerSegments(documentPath);
      const last = segments.at(-1);
      if (last && !/^[0-9]+$/.test(last)) property = last;
    }

    return diagnostic({
      code: `schema.${error.keyword}`,
      message: schemaMessage(error),
      documentPath,
      property,
      document: value,
    });
  });
}

function walkDocumentNodes(document) {
  const entries = [];

  function visit(node, path, ancestors = []) {
    if (!node || typeof node !== "object") return;
    entries.push({ node, path, ancestors });
    if (node.type === "scrollContainer") {
      visit(node.content, `${path}/content`, [...ancestors, node]);
    } else if (node.type === "verticalStack" || node.type === "stack") {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child, `${path}/children/${index}`, [...ancestors, node]);
      }
    } else if (node.type === "carousel") {
      for (const [index, page] of (node.pages ?? []).entries()) {
        visit(
          page.content,
          `${path}/pages/${index}/content`,
          [...ancestors, node],
        );
      }
    }
  }

  visit(document.layout, "/layout");
  return entries;
}

function recursiveOverlay(base, override) {
  if (
    !base ||
    typeof base !== "object" ||
    Array.isArray(base) ||
    !override ||
    typeof override !== "object" ||
    Array.isArray(override)
  ) {
    return structuredClone(override);
  }
  const resolved = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    resolved[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      resolved[key] &&
      typeof resolved[key] === "object" &&
      !Array.isArray(resolved[key])
        ? recursiveOverlay(resolved[key], value)
        : structuredClone(value);
  }
  return resolved;
}

export function resolveProductCardStyle(productSelector, selected) {
  if (!selected) return structuredClone(productSelector.cardStyles.default);
  return recursiveOverlay(
    productSelector.cardStyles.default,
    productSelector.cardStyles.selected,
  );
}

export function runtimeStateForAcceptedRevision(document) {
  const entries = walkDocumentNodes(document);
  return {
    switches: Object.fromEntries(
      entries
        .filter(({ node }) => node.type === "switch")
        .map(({ node }) => [node.id, node.initialValue]),
    ),
    carousels: Object.fromEntries(
      entries
        .filter(({ node }) => node.type === "carousel")
        .map(({ node }) => [node.id, node.initialPageIndex]),
    ),
  };
}

export function evaluateVisibility(visibility, switchValues = {}) {
  if (!visibility || visibility.mode === "always") return true;
  if (visibility.mode === "hidden") return false;
  return switchValues[visibility.switchId] === visibility.equals;
}

export function paywallRuntimeDiagnostics(document, switchValues) {
  if (document?.schemaVersion !== "0.2") return [];
  const entries = walkDocumentNodes(document);
  const values =
    switchValues ?? runtimeStateForAcceptedRevision(document).switches;
  const selectors = new Map(
    entries
      .filter(({ node }) => node.type === "productSelector")
      .map((entry) => [entry.node.id, entry]),
  );
  const diagnostics = [];
  for (const { node } of entries) {
    if (node.type !== "purchaseButton") continue;
    const selector = selectors.get(node.action.productSelectorId);
    const visible =
      selector &&
      [...selector.ancestors, selector.node].every((ancestor) =>
        evaluateVisibility(ancestor.visibility, values),
      );
    if (selector && !visible) {
      diagnostics.push({
        code: "purchase.hiddenProductSelector",
        componentId: node.id,
        productSelectorId: selector.node.id,
        behavior: "disablePurchase",
        message: "Purchase is disabled because its Product Selector is hidden.",
      });
    }
  }
  return diagnostics;
}

export function resolveCountdownState(countdown, now) {
  const nowMilliseconds =
    now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError("Countdown resolution requires a valid controlled clock.");
  }
  const remainingMilliseconds = Math.max(
    Date.parse(countdown.endsAt) - nowMilliseconds,
    0,
  );
  return {
    completed: remainingMilliseconds === 0,
    remainingMilliseconds,
    largestUnit: countdown.largestUnit,
    smallestUnit: countdown.smallestUnit,
    completedText: countdown.completedText,
  };
}

function objectUsesColor(value) {
  if (Array.isArray(value)) return value.some(objectUsesColor);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      (colorFieldNames.has(key) && typeof entry === "string") ||
      objectUsesColor(entry),
  );
}

function expectedDocumentCapabilities(document, nodeEntries) {
  const capabilities = new Set(["localization.catalogs"]);

  if (
    Object.values(document.localization.locales).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    capabilities.add("localization.rtl");
  }
  if (document.products.length > 0) capabilities.add("product.references");
  if (document.assets.length > 0) {
    capabilities.add("asset.bundledImage");
    capabilities.add("fallback.asset");
  }

  for (const { node } of nodeEntries) {
    const capability = capabilityByType[node.type];
    if (capability) capabilities.add(capability);
    if (node.accessibility || node.type === "carousel") {
      capabilities.add("accessibility.metadata");
    }
    if (document.schemaVersion === "0.2") {
      if (node.typography) capabilities.add("style.typography");
      if (
        node.appearance ||
        node.cardStyles ||
        node.padding ||
        (node.type === "scrollContainer" && node.background)
      ) {
        capabilities.add("style.box");
      }
      if (
        node.sizing ||
        node.type === "image"
      ) {
        capabilities.add("layout.sizing");
      }
      if (node.outerInsets) capabilities.add("layout.outerInsets");
      if (Object.hasOwn(node.appearance ?? {}, "clipContent")) {
        capabilities.add("style.clipping");
      }
      if (node.visibility?.mode === "switch") {
        capabilities.add("condition.switchVisibility");
      } else if (node.visibility) {
        capabilities.add("visibility.static");
      }
      if (objectUsesColor(node)) capabilities.add("style.colors");
    }
    if (node.type === "productSelector") {
      capabilities.add("fallback.product");
      capabilities.add("outcome.normalized");
      if (document.schemaVersion === "0.2") {
        capabilities.add("style.productCardStates");
      }
    }
    if (node.action?.type) {
      capabilities.add(`action.${node.action.type}`);
      capabilities.add("outcome.normalized");
    }
  }

  return capabilities;
}

function addDuplicateDiagnostics({
  diagnostics,
  entries,
  field,
  path,
  label,
  document,
  componentId,
}) {
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const value = entry[field];
    if (seen.has(value)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.duplicateIdentifier",
          message: `${label} contains duplicate ${field} ${value}.`,
          documentPath: `${path}/${index}/${field}`,
          componentId,
          property: field,
          document,
        }),
      );
    }
    seen.add(value);
  }
}

function collectLocalizedText(value, path, entries) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectLocalizedText(entry, `${path}/${index}`, entries),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  if (
    typeof value.default === "string" &&
    typeof value.localizationKey === "string"
  ) {
    entries.push({ path, text: value });
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    collectLocalizedText(entry, `${path}/${escapePointer(key)}`, entries);
  }
}

function semanticPaywallDiagnostics(document) {
  const diagnostics = [];
  const manifest =
    document.schemaVersion === "0.2"
      ? compatibilityManifestV02
      : compatibilityManifest;
  const nodeEntries = walkDocumentNodes(document);
  const expectedCapabilities = expectedDocumentCapabilities(
    document,
    nodeEntries,
  );
  const declaredCapabilities = document.compatibility.requiredCapabilities;
  const declaredByName = new Map();
  const supportedByName = new Map(
    manifest.capabilities.map((capability) => [
      capability.name,
      capability.version,
    ]),
  );

  addDuplicateDiagnostics({
    diagnostics,
    entries: declaredCapabilities,
    field: "name",
    path: "/compatibility/requiredCapabilities",
    label: "Document capabilities",
    document,
  });
  declaredCapabilities.forEach((capability) =>
    declaredByName.set(capability.name, capability.version),
  );

  for (const capability of expectedCapabilities) {
    if (!declaredByName.has(capability)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.missingCapability",
          message: `Required capability ${capability} is not declared.`,
          documentPath: "/compatibility/requiredCapabilities",
          property: "requiredCapabilities",
          recoveryMessage: "Restore the capability required by this document.",
          document,
        }),
      );
    }
  }
  for (const [capability, version] of declaredByName) {
    if (!expectedCapabilities.has(capability)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.unusedCapability",
          message: `Capability ${capability} is declared but unused.`,
          documentPath: "/compatibility/requiredCapabilities",
          property: "requiredCapabilities",
          document,
        }),
      );
    } else if (supportedByName.get(capability) !== version) {
      diagnostics.push(
        diagnostic({
          code: "semantic.unsupportedCapability",
          message: `Capability ${capability}@${version} is not supported.`,
          documentPath: "/compatibility/requiredCapabilities",
          property: "requiredCapabilities",
          recoveryAction: "updatePreviewClient",
          recoveryMessage: "Use a supported capability version or update the preview client.",
          document,
        }),
      );
    }
  }

  const seenNodeIds = new Set();
  for (const { node, path } of nodeEntries) {
    if (seenNodeIds.has(node.id)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.duplicateIdentifier",
          message: `Layout tree contains duplicate id ${node.id}.`,
          documentPath: `${path}/id`,
          componentId: node.id,
          property: "id",
          document,
        }),
      );
    }
    seenNodeIds.add(node.id);
    if (node.type === "carousel") {
      for (const [index, page] of node.pages.entries()) {
        if (seenNodeIds.has(page.id)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.duplicateIdentifier",
              message: `Layout tree contains duplicate id ${page.id}.`,
              documentPath: `${path}/pages/${index}/id`,
              componentId: node.id,
              property: "id",
              document,
            }),
          );
        }
        seenNodeIds.add(page.id);
      }
    }
  }
  for (const { node, path } of nodeEntries) {
    if (node.type === "featureList") {
      addDuplicateDiagnostics({
        diagnostics,
        entries: node.items,
        field: "id",
        path: `${path}/items`,
        label: `Feature list ${node.id}`,
        document,
        componentId: node.id,
      });
    }
  }

  addDuplicateDiagnostics({
    diagnostics,
    entries: document.assets,
    field: "id",
    path: "/assets",
    label: "Asset catalog",
    document,
  });
  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const referencedAssets = new Set();
  for (const { node, path } of nodeEntries) {
    if (node.type !== "image") continue;
    if (!assetsById.has(node.assetId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Image ${node.id} references unknown asset ${node.assetId}.`,
          documentPath: `${path}/assetId`,
          componentId: node.id,
          property: "assetId",
          recoveryAction: "editProperty",
          recoveryMessage: "Choose a declared bundled image asset.",
          document,
        }),
      );
    }
    referencedAssets.add(node.assetId);
  }
  for (const [index, asset] of document.assets.entries()) {
    if (!referencedAssets.has(asset.id)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.unusedDeclaration",
          message: `Asset ${asset.id} is declared but unused.`,
          documentPath: `/assets/${index}/id`,
          property: "id",
          recoveryAction: "removeComponent",
          recoveryMessage: "Remove the unused asset or bind it to an image component.",
          document,
        }),
      );
    }
  }

  addDuplicateDiagnostics({
    diagnostics,
    entries: document.products,
    field: "id",
    path: "/products",
    label: "Product catalog",
    document,
  });
  addDuplicateDiagnostics({
    diagnostics,
    entries: document.products,
    field: "productId",
    path: "/products",
    label: "Product catalog",
    document,
  });
  const productsById = new Map(
    document.products.map((product) => [product.id, product]),
  );
  const referencedProducts = new Set();
  const selectorsById = new Map();
  const selectorPaths = new Map();
  const purchaseSelectorIds = new Set();

  for (const { node, path } of nodeEntries) {
    if (node.type === "productSelector") {
      selectorsById.set(node.id, node);
      selectorPaths.set(node.id, path);
      for (const [index, referenceId] of node.productReferenceIds.entries()) {
        if (!productsById.has(referenceId)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Product selector ${node.id} references unknown product ${referenceId}.`,
              documentPath: `${path}/productReferenceIds/${index}`,
              componentId: node.id,
              property: "productReferenceIds",
              recoveryAction: "bindProduct",
              recoveryMessage: "Bind a product declared by this paywall.",
              document,
            }),
          );
        }
        referencedProducts.add(referenceId);
      }
      if (
        !node.productReferenceIds.includes(
          node.initiallySelectedProductReferenceId,
        )
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `Product selector ${node.id} initially selects an unlisted product.`,
            documentPath: `${path}/initiallySelectedProductReferenceId`,
            componentId: node.id,
            property: "initiallySelectedProductReferenceId",
            recoveryAction: "bindProduct",
            recoveryMessage: "Choose one of the products bound to this selector.",
            document,
          }),
        );
      }
    }
    if (node.type === "purchaseButton") {
      purchaseSelectorIds.add(node.action.productSelectorId);
    }
  }
  for (const { node, path } of nodeEntries) {
    if (node.type !== "purchaseButton") continue;
    if (!selectorsById.has(node.action.productSelectorId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Purchase button ${node.id} references an unknown product selector.`,
          documentPath: `${path}/action/productSelectorId`,
          componentId: node.id,
          property: "productSelectorId",
          recoveryAction: "bindProduct",
          recoveryMessage: "Choose a product selector in this paywall.",
          document,
        }),
      );
    }
  }
  for (const [selectorId] of selectorsById) {
    if (!purchaseSelectorIds.has(selectorId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Product selector ${selectorId} has no purchase action.`,
          documentPath: selectorPaths.get(selectorId),
          componentId: selectorId,
          recoveryAction: "bindProduct",
          recoveryMessage: "Add or bind a purchase button to this selector.",
          document,
        }),
      );
    }
  }
  for (const [index, product] of document.products.entries()) {
    if (!referencedProducts.has(product.id)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.unusedDeclaration",
          message: `Product ${product.id} is declared but unused.`,
          documentPath: `/products/${index}/id`,
          property: "id",
          recoveryAction: "bindProduct",
          recoveryMessage: "Bind the product to a selector or remove it.",
          document,
        }),
      );
    }
  }

  const { defaultLocale, fallbackLocale, locales } = document.localization;
  if (!Object.hasOwn(locales, defaultLocale)) {
    diagnostics.push(
      diagnostic({
        code: "semantic.localization",
        message: `Default locale ${defaultLocale} has no catalog.`,
        documentPath: "/localization/defaultLocale",
        property: "defaultLocale",
        document,
      }),
    );
  }
  if (!Object.hasOwn(locales, fallbackLocale)) {
    diagnostics.push(
      diagnostic({
        code: "semantic.localization",
        message: `Fallback locale ${fallbackLocale} has no catalog.`,
        documentPath: "/localization/fallbackLocale",
        property: "fallbackLocale",
        document,
      }),
    );
  }
  if (Object.hasOwn(locales, defaultLocale)) {
    const localizedEntries = [];
    collectLocalizedText(document.assets, "/assets", localizedEntries);
    collectLocalizedText(document.products, "/products", localizedEntries);
    collectLocalizedText(document.layout, "/layout", localizedEntries);
    const referencedKeys = new Set();
    const defaultStrings = locales[defaultLocale].strings;

    for (const { path, text } of localizedEntries) {
      referencedKeys.add(text.localizationKey);
      if (!Object.hasOwn(defaultStrings, text.localizationKey)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.localization",
            message: `Localization key ${text.localizationKey} is missing from the default catalog.`,
            documentPath: `${path}/localizationKey`,
            property: "localizationKey",
            document,
          }),
        );
      } else if (defaultStrings[text.localizationKey] !== text.default) {
        diagnostics.push(
          diagnostic({
            code: "semantic.localization",
            message: `Inline default for ${text.localizationKey} does not match the default catalog.`,
            documentPath: `${path}/default`,
            property: "default",
            document,
          }),
        );
      }
    }
    for (const key of Object.keys(defaultStrings)) {
      if (!referencedKeys.has(key)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.localization",
            message: `Default localization key ${key} is unused.`,
            documentPath: `/localization/locales/${escapePointer(defaultLocale)}/strings/${escapePointer(key)}`,
            property: "strings",
            document,
          }),
        );
      }
    }
    for (const [locale, catalog] of Object.entries(locales)) {
      if (locale === defaultLocale) continue;
      for (const key of Object.keys(catalog.strings)) {
        if (!Object.hasOwn(defaultStrings, key)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.localization",
              message: `Locale ${locale} declares unknown key ${key}.`,
              documentPath: `/localization/locales/${escapePointer(locale)}/strings/${escapePointer(key)}`,
              property: "strings",
              document,
            }),
          );
        }
      }
    }
  }

  if (document.schemaVersion === "0.2") {
    if (document.layout.content.direction !== "vertical") {
      diagnostics.push(
        diagnostic({
          code: "semantic.layout",
          message: "Root scroll content must be a vertical stack.",
          documentPath: "/layout/content/direction",
          componentId: document.layout.content.id,
          property: "direction",
          document,
        }),
      );
    }
    if (document.layout.content.children.length === 0) {
      diagnostics.push(
        diagnostic({
          code: "semantic.layout",
          message: "Root scroll content must contain at least one child.",
          documentPath: "/layout/content/children",
          componentId: document.layout.content.id,
          property: "children",
          document,
        }),
      );
    }
    const switches = new Map(
      nodeEntries
        .filter(({ node }) => node.type === "switch")
        .map(({ node }) => [node.id, node]),
    );
    for (const { node, path } of nodeEntries) {
      if (node.type === "carousel" && path.includes("/pages/")) {
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: `Carousel ${node.id} cannot be nested inside another carousel.`,
            documentPath: path,
            componentId: node.id,
            document,
          }),
        );
      }
      if (
        node.type === "carousel" &&
        node.initialPageIndex >= node.pages.length
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: "Carousel initialPageIndex must reference an existing page.",
            documentPath: `${path}/initialPageIndex`,
            componentId: node.id,
            property: "initialPageIndex",
            document,
          }),
        );
      }
      if (node.visibility?.mode === "switch") {
        const controller = switches.get(node.visibility.switchId);
        if (!controller) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Visibility references unknown switch ${node.visibility.switchId}.`,
              documentPath: `${path}/visibility/switchId`,
              componentId: node.id,
              property: "switchId",
              document,
            }),
          );
        } else if (node.id === controller.id) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: "Visibility cannot reference the same component Switch.",
              documentPath: `${path}/visibility/switchId`,
              componentId: node.id,
              property: "switchId",
              document,
            }),
          );
        }
      }
      if (node.type === "countdown") {
        const instant = Date.parse(node.endsAt);
        const canonical = Number.isFinite(instant)
          ? new Date(instant).toISOString().replace(".000Z", "Z")
          : null;
        if (canonical !== node.endsAt) {
          diagnostics.push(
            diagnostic({
              code: "semantic.timestamp",
              message: "Countdown endsAt must be a canonical UTC instant.",
              documentPath: `${path}/endsAt`,
              componentId: node.id,
              property: "endsAt",
              document,
            }),
          );
        }
        if (
          countdownUnitOrder[node.largestUnit] >
          countdownUnitOrder[node.smallestUnit]
        ) {
          diagnostics.push(
            diagnostic({
              code: "semantic.countdownUnits",
              message:
                "Countdown largestUnit must not be smaller than smallestUnit.",
              documentPath: `${path}/largestUnit`,
              componentId: node.id,
              property: "largestUnit",
              document,
            }),
          );
        }
      }
    }
  }

  return diagnostics;
}

function mockCommerceDiagnostics(document, state, pathPrefix = "") {
  const diagnostics = [];
  const documentProductIds = document.products.map((product) => product.id);
  const seen = new Set();

  for (const [index, product] of state.products.entries()) {
    const productPath = `${pathPrefix}/products/${index}/productReferenceId`;
    if (seen.has(product.productReferenceId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.duplicateIdentifier",
          message: `Mock product ${product.productReferenceId} is declared more than once.`,
          documentPath: productPath,
          property: "productReferenceId",
          recoveryAction: "bindProduct",
          recoveryMessage: "Keep one mock state for each paywall product.",
          document: state,
        }),
      );
    }
    seen.add(product.productReferenceId);
    if (!documentProductIds.includes(product.productReferenceId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Mock commerce references unknown product ${product.productReferenceId}.`,
          documentPath: productPath,
          property: "productReferenceId",
          recoveryAction: "bindProduct",
          recoveryMessage: "Bind mock state only to products in this paywall.",
          document: state,
        }),
      );
    }
  }
  for (const productId of documentProductIds) {
    if (!seen.has(productId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Mock commerce omits paywall product ${productId}.`,
          documentPath: `${pathPrefix}/products`,
          property: "products",
          recoveryAction: "bindProduct",
          recoveryMessage: "Define one mock state for every paywall product.",
          document: state,
        }),
      );
    }
  }
  if (
    state.entitlement.status === "active" &&
    !documentProductIds.includes(state.entitlement.productReferenceId)
  ) {
    diagnostics.push(
      diagnostic({
        code: "semantic.invalidReference",
        message: `Mock entitlement references unknown product ${state.entitlement.productReferenceId}.`,
        documentPath: `${pathPrefix}/entitlement/productReferenceId`,
        property: "productReferenceId",
        recoveryAction: "bindProduct",
        recoveryMessage: "Choose a product declared by this paywall.",
        document: state,
      }),
    );
  }

  return diagnostics;
}

function duplicateCapabilityDiagnostics(message) {
  if (message.type !== "capabilityReport") return [];
  const diagnostics = [];
  for (const field of ["supportedCapabilities", "previewCapabilities"]) {
    const seen = new Set();
    for (const [index, capability] of message.payload[field].entries()) {
      if (seen.has(capability.name)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.duplicateIdentifier",
            message: `Capability ${capability.name} is reported more than once.`,
            documentPath: `/payload/${field}/${index}/name`,
            property: "name",
            recoveryAction: "updatePreviewClient",
            recoveryMessage: "Report each capability name exactly once.",
            document: message,
          }),
        );
      }
      seen.add(capability.name);
    }
  }
  return diagnostics;
}

export function validatePaywallDocument(value) {
  const validator =
    value?.schemaVersion === "0.2"
      ? validatePaywallSchemaV02
      : validatePaywallSchema;
  const schemaErrors = schemaDiagnostics(validator, value);
  if (schemaErrors.length > 0) return failure(schemaErrors);

  const semanticErrors = semanticPaywallDiagnostics(value);
  return semanticErrors.length > 0 ? failure(semanticErrors) : success(value);
}

export function validatePreviewMessage(value, options = {}) {
  const validator =
    value?.previewProtocolVersion === "0.2"
      ? validatePreviewMessageSchemaV02
      : validatePreviewMessageSchema;
  const schemaErrors = schemaDiagnostics(validator, value);
  if (schemaErrors.length > 0) return failure(schemaErrors);

  const diagnostics = duplicateCapabilityDiagnostics(value);
  if (value.type === "draftUpdated") {
    const documentResult = validatePaywallDocument(value.payload.document);
    if (!documentResult.ok) diagnostics.push(...documentResult.diagnostics);
  } else if (
    value.type === "mockCommerceStateChanged" &&
    options.document
  ) {
    diagnostics.push(
      ...mockCommerceDiagnostics(options.document, value.payload.state),
    );
  }

  return diagnostics.length > 0 ? failure(diagnostics) : success(value);
}

export function validateLocalProject(value) {
  const validator =
    value?.fileFormatVersion === "0.2"
      ? validateLocalProjectSchemaV02
      : validateLocalProjectSchema;
  const schemaErrors = schemaDiagnostics(validator, value);
  if (schemaErrors.length > 0) return failure(schemaErrors);

  const documentResult = validatePaywallDocument(value.document);
  if (!documentResult.ok) return failure(documentResult.diagnostics);
  const commerceErrors = mockCommerceDiagnostics(
    value.document,
    value.mockCommerce.state,
    "/mockCommerce/state",
  );
  return commerceErrors.length > 0 ? failure(commerceErrors) : success(value);
}

export function parsePortablePaywallJson(source, options = {}) {
  const maxDocumentBytes = options.maxDocumentBytes ?? 1048576;
  if (new TextEncoder().encode(source).byteLength > maxDocumentBytes) {
    return failure([
      diagnostic({
        code: "validation.documentTooLarge",
        message: "The imported document exceeds the local preview byte limit.",
        recoveryAction: "removeComponent",
        recoveryMessage: "Reduce the document size and import it again.",
      }),
    ]);
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return failure([
      diagnostic({
        code: "validation.invalidJson",
        message: "The imported file is not valid JSON.",
        recoveryAction: "retry",
        recoveryMessage: "Choose a valid Mosaic JSON document and try again.",
      }),
    ]);
  }

  return validatePaywallDocument(value);
}

export function serializePortablePaywallJson(value) {
  const result = validatePaywallDocument(value);
  if (!result.ok) return result;
  return success(`${JSON.stringify(result.value, null, 2)}\n`);
}
