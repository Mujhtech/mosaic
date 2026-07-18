import Ajv2020 from "ajv/dist/2020.js";

import compatibilityManifest from "../compatibility/v0.2.json" with { type: "json" };
import localProjectSchema from "../schema/local-preview/v0.2/local-project.schema.json" with { type: "json" };
import previewMessageSchema from "../schema/local-preview/v0.2/preview-message.schema.json" with { type: "json" };
import paywallSchema from "../schema/v0.2/paywall.schema.json" with { type: "json" };

export const localPreviewContractVersion =
  previewMessageSchema.properties.previewProtocolVersion.const;
export const localPreviewWebSocketProtocol =
  `mosaic.local-preview.v${localPreviewContractVersion}`;
export const localPreviewContractVersions = Object.freeze(["0.2"]);
export const localPreviewVersionPreference = Object.freeze(["0.2"]);
export const localPreviewWebSocketProtocols = Object.freeze({
  "0.2": "mosaic.local-preview.v0.2",
});
export const previewMessageTypes = Object.freeze([
  ...previewMessageSchema.properties.type.enum,
]);
export const previewMessageTypesByVersion = Object.freeze({
  "0.2": previewMessageTypes,
});
export const requiredPreviewCapabilities = Object.freeze([
  ...previewMessageSchema.$defs.previewCapabilityName.enum,
]);
const requiredPreviewCapabilitiesV02 = requiredPreviewCapabilities;
export const canonicalSchemas = Object.freeze({
  paywall: paywallSchema,
  previewMessage: previewMessageSchema,
  localProject: localProjectSchema,
});
export const canonicalSchemasByVersion = Object.freeze({
  "0.2": Object.freeze({
    paywall: paywallSchema,
    previewMessage: previewMessageSchema,
    localProject: localProjectSchema,
  }),
});

function incompatibleSchemaVersionDiagnostic() {
  return {
    code: "preview.incompatibleSchemaVersion",
    message:
      "This preview client cannot receive the current Protocol 0.2 draft.",
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
ajv.addSchema(previewMessageSchema);
const validatePaywallSchema = ajv.getSchema(paywallSchema.$id);
const validatePreviewMessageSchema = ajv.getSchema(previewMessageSchema.$id);
const validateLocalProjectSchema = ajv.compile(localProjectSchema);

if (!validatePaywallSchema || !validatePreviewMessageSchema) {
  throw new Error("Canonical Mosaic schemas were not registered.");
}

const capabilityByType = Object.freeze({
  button: "component.button",
  carousel: "component.carousel",
  closeButton: "component.closeButton",
  featureList: "component.featureList",
  icon: "component.icon",
  image: "component.image",
  legalText: "component.legalText",
  productBadge: "component.productBadge",
  productCard: "component.productCard",
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

const externalUrlPattern =
  /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$/u;
const productTemplatePattern = /\{\{\s*product\.(name|price)\s*\}\}/gu;

function safeAbsoluteHttps(value) {
  const match = externalUrlPattern.exec(value);
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    Boolean(match) &&
    !match[1].includes("..") &&
    match[1].toLowerCase() === url.hostname.toLowerCase() &&
    (match[2] === undefined || Number(match[2]) <= 65535) &&
    [...value].length <= 2048
  );
}

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

  function visit(node, path, screenId, ancestors = []) {
    if (!node || typeof node !== "object") return;
    entries.push({ node, path, screenId, ancestors });
    if (node.type === "scrollContainer") {
      visit(node.content, `${path}/content`, screenId, [...ancestors, node]);
    } else if (node.type === "verticalStack" || node.type === "stack") {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child, `${path}/children/${index}`, screenId, [...ancestors, node]);
      }
    } else if (node.type === "carousel") {
      for (const [index, page] of (node.pages ?? []).entries()) {
        visit(
          page.content,
          `${path}/pages/${index}/content`,
          screenId,
          [...ancestors, node],
        );
      }
    } else if (node.type === "button") {
      for (const [index, child] of node.children.entries()) {
        visit(child, `${path}/children/${index}`, screenId, [...ancestors, node]);
      }
      for (const [index, child] of (node.inProgressChildren ?? []).entries()) {
        visit(
          child,
          `${path}/inProgressChildren/${index}`,
          screenId,
          [...ancestors, node],
        );
      }
    } else if (node.type === "productSelector") {
      for (const [index, card] of (node.cards ?? []).entries()) {
        visit(card, `${path}/cards/${index}`, screenId, [...ancestors, node]);
      }
    } else if (node.type === "productCard" || node.type === "productBadge") {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child, `${path}/children/${index}`, screenId, [...ancestors, node]);
      }
    }
  }

  if (document.schemaVersion === "0.2") {
    for (const [index, screen] of document.screens.entries()) {
      visit(screen.layout, `/screens/${index}/layout`, screen.id);
    }
  } else {
    visit(document.layout, "/layout", null);
  }
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

export function resolveProductCardStyle(productCard, selected) {
  if (!selected) return structuredClone(productCard.styles.default);
  return recursiveOverlay(productCard.styles.default, productCard.styles.selected);
}

export function resolveProductBadgeStyle(productBadge, selected) {
  return resolveProductCardStyle(productBadge, selected);
}

function resolveTokenValue(document, category, referenceType, value) {
  let current = value;
  const seen = new Set();
  const catalog = new Map(
    (document.designSystem?.[category] ?? []).map((token) => [token.id, token.value]),
  );
  while (current?.type === referenceType) {
    if (seen.has(current.id) || !catalog.has(current.id)) return null;
    seen.add(current.id);
    current = catalog.get(current.id);
  }
  return structuredClone(current);
}

export function resolveColorToken(document, color) {
  return resolveTokenValue(document, "colors", "colorToken", color);
}

export function resolveBackgroundToken(document, background) {
  return resolveTokenValue(
    document,
    "backgrounds",
    "backgroundToken",
    background,
  );
}

export function resolveShadowToken(document, shadow) {
  return resolveTokenValue(document, "shadows", "shadowToken", shadow);
}

export function resolveAxisSizing(
  value,
  { axis = "width", bounded = true, componentId = null } = {},
) {
  if (value === "fill" && !bounded) {
    return {
      value: "fit",
      diagnostic: {
        code: "layout.unboundedFill",
        componentId,
        axis,
        behavior: "useFit",
        message: `Fill ${axis} has no bounded parent axis and safely uses Fit.`,
      },
    };
  }
  return { value: structuredClone(value), diagnostic: null };
}

export function resolveMediaBackgroundFallback(
  document,
  background,
  availableAssetIds,
) {
  const resolved = resolveBackgroundToken(document, background);
  if (!resolved || (resolved.type !== "image" && resolved.type !== "video")) {
    return { background: resolved, diagnostic: null };
  }
  const available = new Set(availableAssetIds);
  if (available.has(resolved.assetId)) {
    return { background: resolved, diagnostic: null };
  }
  if (
    resolved.type === "video" &&
    resolved.posterAssetId &&
    available.has(resolved.posterAssetId)
  ) {
    return {
      background: {
        type: "image",
        assetId: resolved.posterAssetId,
        contentMode: resolved.contentMode,
        fallbackColor: structuredClone(resolved.fallbackColor),
      },
      diagnostic: {
        code: "background.videoUnavailable",
        assetId: resolved.assetId,
        behavior: "usePoster",
        message: "Video background is unavailable; the declared poster is used.",
      },
    };
  }
  return {
    background: { type: "color", value: structuredClone(resolved.fallbackColor) },
    diagnostic: {
      code: `background.${resolved.type}Unavailable`,
      assetId: resolved.assetId,
      behavior: "useFallbackColor",
      message: `${resolved.type === "video" ? "Video" : "Image"} background is unavailable; the declared fallback colour is used.`,
    },
  };
}

function analyzeProductTemplate(value) {
  const variables = [];
  const remainder = value.replace(productTemplatePattern, (_match, variable) => {
    variables.push(variable);
    return "";
  });
  return {
    malformed: remainder.includes("{{") || remainder.includes("}}"),
    variables,
  };
}

export function interpolateProductText(value, product) {
  if (typeof value !== "string") {
    return { available: false, value: null, diagnostic: "invalidTemplate" };
  }
  const analysis = analyzeProductTemplate(value);
  if (analysis.malformed) {
    return { available: false, value: null, diagnostic: "invalidTemplate" };
  }
  if (
    analysis.variables.includes("price") &&
    (typeof product?.price !== "string" || product.price.trim().length === 0)
  ) {
    return { available: false, value: null, diagnostic: "missingPrice" };
  }
  const resolvedName =
    typeof product?.name === "string" && product.name.trim().length > 0
      ? product.name
      : product?.fallbackName;
  if (
    analysis.variables.includes("name") &&
    (typeof resolvedName !== "string" || resolvedName.trim().length === 0)
  ) {
    return { available: false, value: null, diagnostic: "missingName" };
  }
  return {
    available: true,
    value: value.replace(productTemplatePattern, (_match, variable) =>
      variable === "name" ? resolvedName : product.price,
    ),
    diagnostic: null,
  };
}

export function resolveProductSelectorSelection(
  productSelector,
  availableProductReferenceIds,
  currentProductCardId = productSelector.initialProductCardId,
) {
  const available = new Set(availableProductReferenceIds);
  const availableCards = productSelector.cards.filter((card) =>
    available.has(card.productReferenceId),
  );
  const current = availableCards.find((card) => card.id === currentProductCardId);
  const selected = current ?? availableCards[0] ?? null;
  return {
    selectedProductCardId: selected?.id ?? null,
    selectedProductReferenceId: selected?.productReferenceId ?? null,
    purchaseEnabled: selected !== null,
    showUnavailableFallback: selected === null,
  };
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
    navigation: {
      currentScreenId: document.initialScreenId,
      history: [document.initialScreenId],
    },
    selectedProducts: Object.fromEntries(
      entries
        .filter(({ node }) => node.type === "productSelector")
        .map(({ node }) => [node.id, node.initialProductCardId]),
    ),
  };
}

export function applyNavigationAction(navigationState, action) {
  const history = [...navigationState.history];
  if (action.type === "navigateTo") {
    history.push(action.screenId);
    return {
      state: { currentScreenId: action.screenId, history },
      diagnostic: null,
    };
  }
  if (history.length <= 1) {
    return {
      state: structuredClone(navigationState),
      diagnostic: {
        code: "navigation.noBackTarget",
        behavior: "noOp",
        message: "Navigate Back has no earlier screen and safely does nothing.",
      },
    };
  }
  history.pop();
  return {
    state: { currentScreenId: history.at(-1), history },
    diagnostic: null,
  };
}

export function evaluateVisibility(visibility, switchValues = {}) {
  if (!visibility || visibility.mode === "always") return true;
  if (visibility.mode === "hidden") return false;
  return switchValues[visibility.switchId] === visibility.equals;
}

export function paywallRuntimeDiagnostics(
  document,
  switchValues,
  navigationState,
) {
  if (document?.schemaVersion !== "0.2") return [];
  const entries = walkDocumentNodes(document);
  const values =
    switchValues ?? runtimeStateForAcceptedRevision(document).switches;
  const navigation = navigationState ?? {
    currentScreenId: document.initialScreenId,
    history: [document.initialScreenId],
  };
  const selectors = new Map(
    entries
      .filter(({ node }) => node.type === "productSelector")
      .map((entry) => [entry.node.id, entry]),
  );
  const diagnostics = [];
  for (const { node, screenId } of entries) {
    if (
      node.type === "button" &&
      node.action.type === "navigateBack" &&
      screenId === navigation.currentScreenId &&
      navigation.history.length <= 1
    ) {
      diagnostics.push({
        code: "navigation.noBackTarget",
        componentId: node.id,
        screenId,
        behavior: "noOp",
        message: "Navigate Back has no earlier screen and safely does nothing.",
      });
    }
    if (node.type !== "button" || node.action.type !== "purchase") continue;
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

function walkObjectValues(value, visit, path = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkObjectValues(entry, visit, `${path}/${index}`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(value, path);
  for (const [key, entry] of Object.entries(value)) {
    walkObjectValues(entry, visit, `${path}/${key}`);
  }
}

function objectUsesColor(value) {
  let usesColor = false;
  walkObjectValues(value, (entry) => {
    if (entry.type === "colorToken") usesColor = true;
    if (
      Object.entries(entry).some(
        ([key, fieldValue]) => colorFieldNames.has(key) && fieldValue !== undefined,
      )
    ) {
      usesColor = true;
    }
  });
  return usesColor;
}

function objectUsesType(value, types) {
  let match = false;
  walkObjectValues(value, (entry) => {
    if (types.has(entry.type)) match = true;
  });
  return match;
}

function objectUsesMediaBackground(value) {
  let match = false;
  walkObjectValues(value, (entry) => {
    if (
      (entry.type === "image" || entry.type === "video") &&
      Object.hasOwn(entry, "fallbackColor")
    ) {
      match = true;
    }
  });
  return match;
}

function localizedTextValues(document, localizedText) {
  const values = [localizedText.default];
  for (const catalog of Object.values(document.localization?.locales ?? {})) {
    if (Object.hasOwn(catalog.strings, localizedText.localizationKey)) {
      values.push(catalog.strings[localizedText.localizationKey]);
    }
  }
  return values;
}

function localizedTextUsesProductTemplate(document, localizedText) {
  return localizedTextValues(document, localizedText).some((value) => {
    const analysis = analyzeProductTemplate(value);
    return analysis.malformed || analysis.variables.length > 0;
  });
}

function documentUsesProductTemplates(document, nodeEntries) {
  if (document.schemaVersion !== "0.2") return false;
  return nodeEntries.some(({ node, ancestors }) =>
    (node.type === "text" &&
      ancestors.some((ancestor) => ancestor.type === "productCard") &&
      localizedTextUsesProductTemplate(document, node.value)) ||
    (node.type === "productCard" &&
      node.accessibility?.label &&
      localizedTextUsesProductTemplate(document, node.accessibility.label)),
  );
}

function expectedDocumentCapabilities(document, nodeEntries) {
  const capabilities = new Set(["localization.catalogs"]);

  if (document.schemaVersion === "0.2") {
    capabilities.add("navigation.screens");
    if (document.screens.some((screen) => screen.presentation?.type === "sheet")) {
      capabilities.add("navigation.sheets");
    }
    if (documentUsesProductTemplates(document, nodeEntries)) {
      capabilities.add("localization.productTemplate");
    }
  }

  if (
    Object.values(document.localization.locales).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    capabilities.add("localization.rtl");
  }
  if (document.products.length > 0) capabilities.add("product.references");
  if (document.schemaVersion === "0.2") {
    const designSystem = document.designSystem ?? {
      colors: [],
      backgrounds: [],
      shadows: [],
    };
    if (
      designSystem.colors.length > 0 ||
      designSystem.backgrounds.length > 0 ||
      designSystem.shadows.length > 0
    ) {
      capabilities.add("style.designTokens");
    }
    const authoredValues = [
      designSystem,
      ...nodeEntries.map(({ node }) => node),
    ];
    if (
      authoredValues.some((value) =>
        objectUsesType(value, new Set(["linearGradient", "radialGradient"])),
      )
    ) {
      capabilities.add("style.gradientBackground");
    }
    if (authoredValues.some((value) => objectUsesMediaBackground(value))) {
      capabilities.add("style.mediaBackground");
    }
    if (
      authoredValues.some((value) =>
        objectUsesType(value, new Set(["shadow", "shadowToken"])),
      )
    ) {
      capabilities.add("style.shadow");
    }
    if (designSystem.colors.length > 0 || objectUsesColor(designSystem)) {
      capabilities.add("style.colors");
    }
    for (const asset of document.assets) {
      const sourceKind = asset.source?.type === "remote" ? "remote" : "bundled";
      if (asset.type === "image") {
        capabilities.add(`asset.${sourceKind}Image`);
        capabilities.add("fallback.asset");
      } else if (asset.type === "video") {
        capabilities.add(`asset.${sourceKind}Video`);
      }
    }
  } else if (document.assets.length > 0) {
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
        node.styles ||
        node.padding ||
        (node.type === "scrollContainer" && node.background)
      ) {
        capabilities.add("style.box");
      }
      if (node.sizing) {
        capabilities.add("layout.sizing");
        if (Object.hasOwn(node.sizing, "height")) {
          capabilities.add("layout.heightSizing");
        }
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
    if (
      document.schemaVersion === "0.2" &&
      (node.type === "productCard" || node.type === "productBadge")
    ) {
      capabilities.add("style.productCardStates");
    }
    if (node.action?.type) {
      capabilities.add(`action.${node.action.type}`);
      if (["purchase", "restore", "close"].includes(node.action.type)) {
        capabilities.add("outcome.normalized");
      }
    }
  }

  return capabilities;
}

function orderedV02CapabilitiesForDocument(document) {
  const expected = expectedDocumentCapabilities(
    document,
    walkDocumentNodes(document),
  );
  return paywallSchema.$defs.capabilityName.enum
    .filter((name) => expected.has(name))
    .map((name) => ({ name, version: "0.2" }));
}

function allocateRC3Identifier(usedIds, preferred) {
  let sequence = 1;
  while (true) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const base = preferred
      .slice(0, 128 - suffix.length)
      .replace(/[-_]+$/u, "");
    const candidate = `${base}${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    sequence += 1;
  }
}

function collectRC3Identifiers(value, identifiers = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRC3Identifiers(entry, identifiers);
    return identifiers;
  }
  if (!isRecord(value)) return identifiers;
  if (typeof value.id === "string") identifiers.add(value.id);
  for (const entry of Object.values(value)) {
    collectRC3Identifiers(entry, identifiers);
  }
  return identifiers;
}

function addRC3TemplateLocalization(state, variable) {
  let key;
  do {
    state.templateKeySequence += 1;
    key =
      `mosaic.migration.rc2_product_card_${state.templateKeySequence}.` +
      variable;
  } while (
    Object.values(state.document.localization.locales).some((locale) =>
      Object.hasOwn(locale.strings, key),
    )
  );
  const value = `{{ product.${variable} }}`;
  for (const locale of Object.values(state.document.localization.locales)) {
    locale.strings[key] = value;
  }
  return { default: value, localizationKey: key };
}

function rc3TextChild(state, cardId, variable, color) {
  return {
    type: "text",
    id: allocateRC3Identifier(state.usedIds, `${cardId}-${variable}`),
    value: addRC3TemplateLocalization(state, variable),
    typography: {
      style: "body",
      fontSize: 16,
      lineHeightMultiplier: 1.5,
      weight: "regular",
      color,
      alignment: "start",
    },
    accessibility: { role: "text" },
  };
}

function rc3StateStyles(defaultStyle, selectedStyle = {}) {
  return {
    default: {
      background: defaultStyle.background,
      border: structuredClone(defaultStyle.border),
      cornerRadius: defaultStyle.cornerRadius,
      padding: structuredClone(defaultStyle.padding),
      opacity: 1,
    },
    selected: Object.fromEntries(
      ["background", "border", "cornerRadius", "padding"]
        .filter((field) => Object.hasOwn(selectedStyle, field))
        .map((field) => [field, structuredClone(selectedStyle[field])]),
    ),
  };
}

function addRC3MigrationDiagnostic(state, selector, field, message) {
  const key = `${selector.id}:${field}`;
  if (state.diagnosticFields.has(key)) return;
  state.diagnosticFields.add(key);
  state.diagnostics.push({
    code: "migration.reviewRequired",
    severity: "reviewRequired",
    selectorId: selector.id,
    field,
    message,
  });
}

function reportRC3UnrepresentableOverrides(state, selector) {
  const { default: base, selected } = selector.cardStyles;
  for (const field of ["contentGap", "contentAlignment"]) {
    if (Object.hasOwn(selected, field) && selected[field] !== base[field]) {
      addRC3MigrationDiagnostic(
        state,
        selector,
        `cardStyles.selected.${field}`,
        `Selected-only ${field} is layout in RC3 and requires author review.`,
      );
    }
  }
  for (const field of ["productLabelColor", "runtimePriceColor"]) {
    if (Object.hasOwn(selected, field) && selected[field] !== base[field]) {
      addRC3MigrationDiagnostic(
        state,
        selector,
        `cardStyles.selected.${field}`,
        `Selected-only ${field} cannot be represented by state-independent Text styling.`,
      );
    }
  }
  if (
    selected.badge?.textColor !== undefined &&
    selected.badge.textColor !== base.badge.textColor
  ) {
    addRC3MigrationDiagnostic(
      state,
      selector,
      "cardStyles.selected.badge.textColor",
      "Selected-only badge textColor cannot be represented by state-independent Text styling.",
    );
  }
}

function rc3BadgeForProduct(state, selector, cardId, product) {
  if (!product?.badge) return null;
  const badgeId = allocateRC3Identifier(state.usedIds, `${cardId}-badge`);
  return {
    type: "productBadge",
    id: badgeId,
    placement: { mode: "nested" },
    direction: "horizontal",
    gap: 0,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: allocateRC3Identifier(state.usedIds, `${badgeId}-label`),
        value: structuredClone(product.badge),
        typography: {
          style: "label",
          fontSize: 16,
          lineHeightMultiplier: 1.25,
          weight: "semibold",
          color: selector.cardStyles.default.badge.textColor,
          alignment: "center",
        },
        accessibility: { role: "text" },
      },
    ],
    styles: rc3StateStyles(
      selector.cardStyles.default.badge,
      selector.cardStyles.selected.badge,
    ),
  };
}

function migrateRC3Selector(selector, state) {
  reportRC3UnrepresentableOverrides(state, selector);
  const cards = selector.productReferenceIds.map((productReferenceId) => {
    const product = state.products.get(productReferenceId);
    const cardId = allocateRC3Identifier(
      state.usedIds,
      `${selector.id}-${productReferenceId}-card`,
    );
    const children = [
      rc3TextChild(
        state,
        cardId,
        "name",
        selector.cardStyles.default.productLabelColor,
      ),
      rc3TextChild(
        state,
        cardId,
        "price",
        selector.cardStyles.default.runtimePriceColor,
      ),
    ];
    const badge = rc3BadgeForProduct(state, selector, cardId, product);
    if (badge) children.push(badge);
    return {
      type: "productCard",
      id: cardId,
      productReferenceId,
      direction: "vertical",
      gap: selector.cardStyles.default.contentGap,
      mainAxisDistribution: selector.cardStyles.default.contentAlignment,
      crossAxisAlignment: "stretch",
      children,
      styles: rc3StateStyles(
        selector.cardStyles.default,
        selector.cardStyles.selected,
      ),
    };
  });
  return {
    type: "productSelector",
    id: selector.id,
    direction: selector.direction,
    gap: selector.gap,
    crossAxisAlignment: "stretch",
    initialProductCardId: cards.find(
      (card) =>
        card.productReferenceId ===
        selector.initiallySelectedProductReferenceId,
    )?.id,
    cards,
    ...(selector.appearance
      ? { appearance: structuredClone(selector.appearance) }
      : {}),
    ...(selector.sizing ? { sizing: structuredClone(selector.sizing) } : {}),
    ...(selector.outerInsets
      ? { outerInsets: structuredClone(selector.outerInsets) }
      : {}),
    ...(selector.visibility
      ? { visibility: structuredClone(selector.visibility) }
      : {}),
    unavailableFallback: structuredClone(selector.unavailableFallback),
    accessibility: structuredClone(selector.accessibility),
  };
}

function migrateRC3Node(node, state) {
  if (!isRecord(node)) return node;
  if (
    node.type === "productSelector" &&
    Array.isArray(node.productReferenceIds) &&
    isRecord(node.cardStyles)
  ) {
    return migrateRC3Selector(node, state);
  }
  const migrated = structuredClone(node);
  if (migrated.type === "scrollContainer") {
    migrated.content = migrateRC3Node(migrated.content, state);
  } else if (migrated.type === "stack") {
    migrated.children = migrated.children.map((child) =>
      migrateRC3Node(child, state),
    );
  } else if (migrated.type === "carousel") {
    migrated.pages = migrated.pages.map((page) => ({
      ...page,
      content: migrateRC3Node(page.content, state),
    }));
  } else if (migrated.type === "button") {
    migrated.children = migrated.children.map((child) =>
      migrateRC3Node(child, state),
    );
    if (migrated.inProgressChildren) {
      migrated.inProgressChildren = migrated.inProgressChildren.map((child) =>
        migrateRC3Node(child, state),
      );
    }
  }
  return migrated;
}

const rc4AuthoredBoxTypes = new Set([
  "button",
  "carousel",
  "countdown",
  "featureList",
  "icon",
  "image",
  "productBadge",
  "productCard",
  "productSelector",
  "stack",
  "switch",
  "text",
]);

function rc4AxisSizing(value, fallback = "fit") {
  if (value === undefined) return fallback;
  if (value === "content") return "fit";
  return structuredClone(value);
}

function migrateRC4BackgroundFields(value) {
  if (Array.isArray(value)) return value.map(migrateRC4BackgroundFields);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "background" &&
      (typeof entry === "string" || entry?.type === "colorToken")
        ? { type: "color", value: structuredClone(entry) }
        : migrateRC4BackgroundFields(entry),
    ]),
  );
}

function migrateRC4Node(source) {
  const node = migrateRC4BackgroundFields(source);
  if (node.type === "scrollContainer") {
    node.content = migrateRC4Node(node.content);
    return node;
  }
  if (rc4AuthoredBoxTypes.has(node.type)) {
    if (node.type === "image") {
      node.sizing = {
        width: rc4AxisSizing(node.width ?? node.sizing?.width),
        height:
          node.height === undefined
            ? rc4AxisSizing(node.sizing?.height)
            : { mode: "fixed", value: node.height },
      };
      delete node.width;
      delete node.height;
    } else if (node.sizing) {
      node.sizing = {
        width: rc4AxisSizing(node.sizing.width),
        height: rc4AxisSizing(node.sizing.height),
      };
    }
  }
  if (node.type === "stack") {
    node.children = node.children.map(migrateRC4Node);
  } else if (node.type === "carousel") {
    node.pages = node.pages.map((page) => ({
      ...page,
      content: migrateRC4Node(page.content),
    }));
  } else if (node.type === "button") {
    node.children = node.children.map(migrateRC4Node);
    if (node.inProgressChildren) {
      node.inProgressChildren = node.inProgressChildren.map(migrateRC4Node);
    }
  } else if (node.type === "productSelector") {
    node.cards = node.cards.map(migrateRC4Node);
  } else if (node.type === "productCard" || node.type === "productBadge") {
    node.children = node.children.map(migrateRC4Node);
  }
  return node;
}

export function migrateV02RC3CandidateToRC4(document) {
  if (!isRecord(document) || document.schemaVersion !== "0.2") {
    throw new Error("RC3 candidate recovery requires a Protocol 0.2 document.");
  }
  const migrated = migrateRC4BackgroundFields(structuredClone(document));
  migrated.designSystem ??= { colors: [], backgrounds: [], shadows: [] };
  migrated.screens = migrated.screens.map((screen) => ({
    ...screen,
    presentation: screen.presentation ?? { type: "screen" },
    layout: migrateRC4Node(screen.layout),
  }));
  migrated.compatibility.requiredCapabilities =
    orderedV02CapabilitiesForDocument(migrated);
  return { document: migrated, diagnostics: [] };
}

export function migrateV02RC2CandidateToRC3(document) {
  if (!isRecord(document) || document.schemaVersion !== "0.2") {
    throw new Error("RC2 candidate recovery requires a Protocol 0.2 document.");
  }
  const migrated = structuredClone(document);
  const state = {
    diagnosticFields: new Set(),
    diagnostics: [],
    document: migrated,
    products: new Map(migrated.products.map((product) => [product.id, product])),
    templateKeySequence: 0,
    usedIds: collectRC3Identifiers(migrated),
  };
  migrated.screens = migrated.screens.map((screen) => ({
    ...screen,
    layout: migrateRC3Node(screen.layout, state),
  }));
  for (const product of migrated.products) delete product.badge;
  migrated.compatibility.requiredCapabilities =
    orderedV02CapabilitiesForDocument(migrated);
  const rc4 = migrateV02RC3CandidateToRC4(migrated);
  return {
    document: rc4.document,
    diagnostics: [...state.diagnostics, ...rc4.diagnostics],
  };
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
  const manifest = compatibilityManifest;
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

  if (document.schemaVersion === "0.2") {
    const catalogs = {
      colorToken: document.designSystem.colors,
      backgroundToken: document.designSystem.backgrounds,
      shadowToken: document.designSystem.shadows,
    };
    for (const [type, catalog] of Object.entries(catalogs)) {
      const category =
        type === "colorToken"
          ? "colors"
          : type === "backgroundToken"
            ? "backgrounds"
            : "shadows";
      addDuplicateDiagnostics({
        diagnostics,
        entries: catalog,
        field: "id",
        path: `/designSystem/${category}`,
        label: `${type} catalog`,
        document,
      });
      addDuplicateDiagnostics({
        diagnostics,
        entries: catalog,
        field: "name",
        path: `/designSystem/${category}`,
        label: `${type} catalog`,
        document,
      });
    }
    const known = Object.fromEntries(
      Object.entries(catalogs).map(([type, catalog]) => [
        type,
        new Set(catalog.map((token) => token.id)),
      ]),
    );
    const roots = [document.designSystem, ...nodeEntries.map(({ node }) => node)];
    for (const root of roots) {
      walkObjectValues(root, (value, path) => {
        if (!Object.hasOwn(catalogs, value.type)) return;
        if (!known[value.type].has(value.id)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `${value.type} references unknown token ${value.id}.`,
              documentPath: path,
              property: "id",
              document,
            }),
          );
        }
      });
    }
    for (const [type, catalog] of Object.entries(catalogs)) {
      const graph = new Map(catalog.map((token) => [token.id, new Set()]));
      for (const token of catalog) {
        walkObjectValues(token.value, (value) => {
          if (value.type === type) graph.get(token.id).add(value.id);
        });
      }
      const visiting = new Set();
      const visited = new Set();
      function hasCycle(id) {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const target of graph.get(id) ?? []) {
          if (graph.has(target) && hasCycle(target)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
      }
      if ([...graph.keys()].some(hasCycle)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.tokenCycle",
            message: `${type} catalog contains a reference cycle.`,
            documentPath: "/designSystem",
            property: "designSystem",
            document,
          }),
        );
      }
    }
    for (const root of roots) {
      walkObjectValues(root, (value, path) => {
        if (value.type !== "linearGradient" && value.type !== "radialGradient") {
          return;
        }
        let prior = -1;
        for (const stop of value.stops) {
          if (stop.position <= prior) {
            diagnostics.push(
              diagnostic({
                code: "semantic.gradientStops",
                message: "Gradient stops must be ordered with unique positions.",
                documentPath: `${path}/stops`,
                property: "stops",
                document,
              }),
            );
            break;
          }
          prior = stop.position;
        }
      });
    }
  }

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

  if (document.schemaVersion === "0.2") {
    addDuplicateDiagnostics({
      diagnostics,
      entries: document.screens,
      field: "id",
      path: "/screens",
      label: "Screen catalog",
      document,
    });
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
    const asset = assetsById.get(node.assetId);
    if (!asset || asset.type !== "image") {
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
  if (document.schemaVersion === "0.2") {
    for (const [index, asset] of document.assets.entries()) {
      if (asset.source.type === "remote" && !safeAbsoluteHttps(asset.source.url)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.externalUrl",
            message: "Remote asset URL must be safe absolute HTTPS without credentials.",
            documentPath: `/assets/${index}/source/url`,
            property: "url",
            document,
          }),
        );
      }
    }
    const backgroundRoots = [document.designSystem, ...nodeEntries.map(({ node }) => node)];
    for (const root of backgroundRoots) {
      walkObjectValues(root, (value, path) => {
        if (
          (value.type !== "image" && value.type !== "video") ||
          !Object.hasOwn(value, "fallbackColor")
        ) {
          return;
        }
        const asset = assetsById.get(value.assetId);
        if (!asset || asset.type !== value.type) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `${value.type} background must reference a declared ${value.type} asset.`,
              documentPath: `${path}/assetId`,
              property: "assetId",
              document,
            }),
          );
        } else {
          referencedAssets.add(value.assetId);
        }
        if (value.type === "video" && value.posterAssetId) {
          const poster = assetsById.get(value.posterAssetId);
          if (!poster || poster.type !== "image") {
            diagnostics.push(
              diagnostic({
                code: "semantic.invalidReference",
                message: "Video poster must reference a declared image asset.",
                documentPath: `${path}/posterAssetId`,
                property: "posterAssetId",
                document,
              }),
            );
          } else {
            referencedAssets.add(value.posterAssetId);
          }
        }
      });
    }
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
  const purchaseSelectorIds = new Set();

  for (const entry of nodeEntries) {
    const { node, path, screenId } = entry;
    if (node.type === "productSelector") {
      selectorsById.set(node.id, entry);
      const references =
        document.schemaVersion === "0.2"
          ? node.cards.map((card) => card.productReferenceId)
          : node.productReferenceIds;
      const selectorReferences = new Set();
      for (const [index, referenceId] of references.entries()) {
        if (!productsById.has(referenceId)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Product selector ${node.id} references unknown product ${referenceId}.`,
              documentPath:
                document.schemaVersion === "0.2"
                  ? `${path}/cards/${index}/productReferenceId`
                  : `${path}/productReferenceIds/${index}`,
              componentId: node.id,
              property:
                document.schemaVersion === "0.2"
                  ? "productReferenceId"
                  : "productReferenceIds",
              recoveryAction: "bindProduct",
              recoveryMessage: "Bind a product declared by this paywall.",
              document,
            }),
          );
        }
        if (selectorReferences.has(referenceId)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.duplicateReference",
              message: `Product selector ${node.id} contains duplicate product reference ${referenceId}.`,
              documentPath: `${path}/cards/${index}/productReferenceId`,
              componentId: node.id,
              property: "productReferenceId",
              recoveryAction: "bindProduct",
              recoveryMessage: "Bind every Product Card to a unique product reference.",
              document,
            }),
          );
        }
        selectorReferences.add(referenceId);
        referencedProducts.add(referenceId);
      }
      const initialIsValid =
        document.schemaVersion === "0.2"
          ? node.cards.some((card) => card.id === node.initialProductCardId)
          : node.productReferenceIds.includes(
              node.initiallySelectedProductReferenceId,
            );
      if (!initialIsValid) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `Product selector ${node.id} initially selects an unlisted ${document.schemaVersion === "0.2" ? "Product Card" : "product"}.`,
            documentPath:
              document.schemaVersion === "0.2"
                ? `${path}/initialProductCardId`
                : `${path}/initiallySelectedProductReferenceId`,
            componentId: node.id,
            property:
              document.schemaVersion === "0.2"
                ? "initialProductCardId"
                : "initiallySelectedProductReferenceId",
            recoveryAction: "bindProduct",
            recoveryMessage: "Choose one of the products bound to this selector.",
            document,
          }),
        );
      }
    }
    if (
      node.type === "purchaseButton" ||
      (node.type === "button" && node.action.type === "purchase")
    ) {
      purchaseSelectorIds.add(`${screenId ?? "root"}:${node.action.productSelectorId}`);
    }
  }
  for (const { node, path, screenId } of nodeEntries) {
    if (
      node.type !== "purchaseButton" &&
      !(node.type === "button" && node.action.type === "purchase")
    ) {
      continue;
    }
    const selectorEntry = selectorsById.get(node.action.productSelectorId);
    if (!selectorEntry) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Button ${node.id} references an unknown product selector.`,
          documentPath: `${path}/action/productSelectorId`,
          componentId: node.id,
          property: "productSelectorId",
          recoveryAction: "bindProduct",
          recoveryMessage: "Choose a product selector in this paywall.",
          document,
        }),
      );
    } else if (
      document.schemaVersion === "0.2" &&
      selectorEntry.screenId !== screenId
    ) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Purchase button ${node.id} must target a Product Selector on the same screen.`,
          documentPath: `${path}/action/productSelectorId`,
          componentId: node.id,
          property: "productSelectorId",
          recoveryAction: "bindProduct",
          recoveryMessage: "Choose a product selector on this screen.",
          document,
        }),
      );
    }
  }
  for (const [selectorId, selectorEntry] of selectorsById) {
    const selectorScreen = selectorEntry.screenId ?? "root";
    if (!purchaseSelectorIds.has(`${selectorScreen}:${selectorId}`)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Product selector ${selectorId} has no purchase action.`,
          documentPath: selectorEntry.path,
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
    if (document.schemaVersion === "0.2") {
      collectLocalizedText(document.screens, "/screens", localizedEntries);
    } else {
      collectLocalizedText(document.layout, "/layout", localizedEntries);
    }
    const referencedKeys = new Set();
    const defaultStrings = locales[defaultLocale].strings;
    const templateAllowed = new Set();
    if (document.schemaVersion === "0.2") {
      for (const { node, ancestors } of nodeEntries) {
        if (
          node.type === "text" &&
          ancestors.some((ancestor) => ancestor.type === "productCard")
        ) {
          templateAllowed.add(node.value);
        }
        if (node.type === "productCard" && node.accessibility?.label) {
          templateAllowed.add(node.accessibility.label);
        }
      }
    }

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
      if (document.schemaVersion === "0.2") {
        for (const value of localizedTextValues(document, text)) {
          const analysis = analyzeProductTemplate(value);
          if (analysis.malformed) {
            diagnostics.push(
              diagnostic({
                code: "semantic.productTemplate",
                message: "The product template expression is malformed or unsupported.",
                documentPath: `${path}/default`,
                componentId: locationFor(document, path).componentId,
                property: "default",
                document,
              }),
            );
          }
          if (analysis.variables.length > 0 && !templateAllowed.has(text)) {
            diagnostics.push(
              diagnostic({
                code: "semantic.productTemplate",
                message: "Product templates are valid only in Text or a card accessibility label within Product Card content.",
                documentPath: `${path}/default`,
                componentId: locationFor(document, path).componentId,
                property: "default",
                document,
              }),
            );
          }
        }
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
    const screensById = new Map(
      document.screens.map((screen) => [screen.id, screen]),
    );
    if (!screensById.has(document.initialScreenId)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.invalidReference",
          message: `Initial screen ${document.initialScreenId} does not exist.`,
          documentPath: "/initialScreenId",
          property: "initialScreenId",
          document,
        }),
      );
    } else if (
      screensById.get(document.initialScreenId).presentation.type !== "screen"
    ) {
      diagnostics.push(
        diagnostic({
          code: "semantic.presentation",
          message: "Initial screen presentation must be Screen.",
          documentPath: "/initialScreenId",
          property: "initialScreenId",
          document,
        }),
      );
    }
    for (const [index, screen] of document.screens.entries()) {
      const root = screen.layout.content;
      if (root.direction !== "vertical") {
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: `Screen ${screen.id} root scroll content must be a vertical stack.`,
            documentPath: `/screens/${index}/layout/content/direction`,
            componentId: root.id,
            property: "direction",
            document,
          }),
        );
      }
      if (root.children.length === 0) {
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: `Screen ${screen.id} root scroll content must contain at least one child.`,
            documentPath: `/screens/${index}/layout/content/children`,
            componentId: root.id,
            property: "children",
            document,
          }),
        );
      }
    }
    const switches = new Map(
      nodeEntries
        .filter(({ node }) => node.type === "switch")
        .map((entry) => [entry.node.id, entry]),
    );
    const navigationEdges = new Map(
      document.screens.map((screen) => [screen.id, new Set()]),
    );
    const interactiveButtonDescendants = new Set([
      "button",
      "productSelector",
      "switch",
      "carousel",
    ]);
    for (const { node, path, screenId, ancestors } of nodeEntries) {
      if (node.type === "productCard") {
        if (ancestors.at(-1)?.type !== "productSelector") {
          diagnostics.push(
            diagnostic({
              code: "semantic.layout",
              message: "Product Card must be directly owned by a Product Selector.",
              documentPath: path,
              componentId: node.id,
              document,
            }),
          );
        }
        const badges = node.children.filter(
          (child) => child.type === "productBadge",
        );
        if (badges.length > 1) {
          diagnostics.push(
            diagnostic({
              code: "semantic.layout",
              message: "Product Card may contain at most one direct Product Badge.",
              documentPath: `${path}/children`,
              componentId: node.id,
              property: "children",
              document,
            }),
          );
        }
        let passiveDescendants = 0;
        let maximumStackDepth = 0;
        const visitPassive = (child, stackDepth = 0) => {
          passiveDescendants += 1;
          const nextDepth = child.type === "stack" ? stackDepth + 1 : stackDepth;
          maximumStackDepth = Math.max(maximumStackDepth, nextDepth);
          for (const descendant of child.children ?? []) {
            visitPassive(descendant, nextDepth);
          }
        };
        for (const child of node.children) visitPassive(child);
        if (passiveDescendants > 20 || maximumStackDepth > 4) {
          diagnostics.push(
            diagnostic({
              code: "semantic.layout",
              message:
                passiveDescendants > 20
                  ? "Product Card exceeds 20 passive descendants."
                  : "Product Card exceeds nested Stack depth 4.",
              documentPath: `${path}/children`,
              componentId: node.id,
              property: "children",
              document,
            }),
          );
        }
      }
      if (
        node.type === "productBadge" &&
        ancestors.at(-1)?.type !== "productCard"
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: "Product Badge must be a direct Product Card child.",
            documentPath: path,
            componentId: node.id,
            document,
          }),
        );
      }
      if (
        ancestors.some((ancestor) => ancestor.type === "button") &&
        interactiveButtonDescendants.has(node.type)
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: `Button content cannot contain interactive ${node.type}.`,
            documentPath: path,
            componentId: node.id,
            document,
          }),
        );
      }
      if (
        node.type === "button" &&
        node.inProgressChildren &&
        !["purchase", "restore"].includes(node.action.type)
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.action",
            message: "inProgressChildren are valid only for purchase or restore.",
            documentPath: `${path}/inProgressChildren`,
            componentId: node.id,
            property: "inProgressChildren",
            document,
          }),
        );
      }
      if (
        node.type === "carousel" &&
        ancestors.some((ancestor) => ancestor.type === "carousel")
      ) {
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
        } else if (node.id === controller.node.id) {
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
        } else if (controller.screenId !== screenId) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: "Visibility must reference a Switch on the same screen.",
              documentPath: `${path}/visibility/switchId`,
              componentId: node.id,
              property: "switchId",
              document,
            }),
          );
        }
      }
      if (node.type === "button" && node.action.type === "navigateTo") {
        const target = node.action.screenId;
        if (!screensById.has(target)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Navigate To references unknown screen ${target}.`,
              documentPath: `${path}/action/screenId`,
              componentId: node.id,
              property: "screenId",
              document,
            }),
          );
        } else if (target === screenId) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: "Navigate To target must differ from its source screen.",
              documentPath: `${path}/action/screenId`,
              componentId: node.id,
              property: "screenId",
              document,
            }),
          );
        } else {
          navigationEdges.get(screenId)?.add(target);
        }
      }
      if (node.type === "button" && node.action.type === "openExternalUrl") {
        const value = node.action.url;
        if (!safeAbsoluteHttps(value)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.externalUrl",
              message: "External URL must be safe absolute HTTPS without credentials.",
              documentPath: `${path}/action/url`,
              componentId: node.id,
              property: "url",
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

    if (screensById.has(document.initialScreenId)) {
      const reachable = new Set();
      const pending = [document.initialScreenId];
      while (pending.length > 0) {
        const screenId = pending.pop();
        if (reachable.has(screenId)) continue;
        reachable.add(screenId);
        pending.push(...(navigationEdges.get(screenId) ?? []));
      }
      for (const [index, screen] of document.screens.entries()) {
        if (!reachable.has(screen.id)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Screen ${screen.id} is unreachable from the initial screen.`,
              documentPath: `/screens/${index}/id`,
              property: "id",
              document,
            }),
          );
        }
      }
    }

    const visiting = new Set();
    const visited = new Set();
    function graphHasCycle(screenId) {
      if (visiting.has(screenId)) return true;
      if (visited.has(screenId)) return false;
      visiting.add(screenId);
      for (const target of navigationEdges.get(screenId) ?? []) {
        if (graphHasCycle(target)) return true;
      }
      visiting.delete(screenId);
      visited.add(screenId);
      return false;
    }
    if (document.screens.some((screen) => graphHasCycle(screen.id))) {
      diagnostics.push(
        diagnostic({
          code: "semantic.navigationCycle",
          message: "Navigate To graph must be acyclic.",
          documentPath: "/screens",
          property: "screens",
          document,
        }),
      );
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
  const schemaErrors = schemaDiagnostics(validatePaywallSchema, value);
  if (schemaErrors.length > 0) return failure(schemaErrors);

  const semanticErrors = semanticPaywallDiagnostics(value);
  return semanticErrors.length > 0 ? failure(semanticErrors) : success(value);
}

export function validatePreviewMessage(value, options = {}) {
  const schemaErrors = schemaDiagnostics(validatePreviewMessageSchema, value);
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
  const schemaErrors = schemaDiagnostics(validateLocalProjectSchema, value);
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
