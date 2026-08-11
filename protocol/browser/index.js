import Ajv2020 from "ajv/dist/2020.js";

import compatibilityManifest from "../compatibility/v0.3.json" with { type: "json" };
import compatibilityManifestV04 from "../compatibility/v0.4.json" with { type: "json" };
import localProjectSchema from "../schema/local-preview/v0.3/local-project.schema.json" with { type: "json" };
import localProjectV04Schema from "../schema/local-preview/v0.4/local-project.schema.json" with { type: "json" };
import previewMessageSchema from "../schema/local-preview/v0.3/preview-message.schema.json" with { type: "json" };
import previewMessageV04Schema from "../schema/local-preview/v0.4/preview-message.schema.json" with { type: "json" };
import paywallSchema from "../schema/v0.3/paywall.schema.json" with { type: "json" };
import paywallV04Schema from "../schema/v0.4/paywall.schema.json" with { type: "json" };

export const localPreviewContractVersion =
  previewMessageSchema.properties.previewProtocolVersion.const;
export const localPreviewV04ContractVersion =
  previewMessageV04Schema.properties.previewProtocolVersion.const;
export const localPreviewWebSocketProtocol =
  `mosaic.local-preview.v${localPreviewContractVersion}`;
export const localPreviewContractVersions = Object.freeze(["0.3", "0.4"]);
/**
 * Negotiation order, most preferred first.
 *
 * `0.4` leads because a preview client that speaks it can render motion, and a
 * client that cannot still gets `0.3`. The singular
 * `localPreviewContractVersion` deliberately stays `0.3`: it names the release
 * candidate, not the newest draft, exactly as `paywallContractVersion` does.
 */
export const localPreviewVersionPreference = Object.freeze(["0.4", "0.3"]);
export const localPreviewWebSocketProtocols = Object.freeze({
  "0.3": "mosaic.local-preview.v0.3",
  "0.4": "mosaic.local-preview.v0.4",
});
export const previewMessageTypes = Object.freeze([
  ...previewMessageSchema.properties.type.enum,
]);
export const previewMessageTypesByVersion = Object.freeze({
  "0.3": previewMessageTypes,
  "0.4": Object.freeze([...previewMessageV04Schema.properties.type.enum]),
});
export const requiredPreviewCapabilities = Object.freeze([
  ...previewMessageSchema.$defs.previewCapabilityName.enum,
]);
const requiredPreviewCapabilitiesV03 = requiredPreviewCapabilities;
const requiredPreviewCapabilitiesByVersion = Object.freeze({
  "0.3": requiredPreviewCapabilitiesV03,
  "0.4": Object.freeze([
    ...previewMessageV04Schema.$defs.previewCapabilityName.enum,
  ]),
});
export const canonicalSchemas = Object.freeze({
  paywall: paywallSchema,
  previewMessage: previewMessageSchema,
  localProject: localProjectSchema,
});
export const canonicalSchemasByVersion = Object.freeze({
  "0.3": Object.freeze({
    paywall: paywallSchema,
    previewMessage: previewMessageSchema,
    localProject: localProjectSchema,
  }),
  "0.4": Object.freeze({
    paywall: paywallV04Schema,
    previewMessage: previewMessageV04Schema,
    localProject: localProjectV04Schema,
  }),
});

function incompatibleSchemaVersionDiagnostic(version = "0.3") {
  return {
    code: "preview.incompatibleSchemaVersion",
    message: `This preview client cannot receive the current Protocol ${version} draft.`,
    fallback: "keepLastAcceptedDraft",
    recovery: {
      action: "updatePreviewClient",
      message: `Update the preview client to a version that supports Local Preview and Protocol ${version}.`,
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
  const selectedVersion = negotiation.selectedVersion;
  if (selectedVersion !== document.schemaVersion) {
    return {
      delivery: "withhold",
      diagnostic: incompatibleSchemaVersionDiagnostic(document.schemaVersion),
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
      diagnostic: incompatibleSchemaVersionDiagnostic(document.schemaVersion),
    };
  }
  const previewCapabilities = new Map(
    capabilityReport.previewCapabilities.map(({ name, version }) => [
      name,
      version,
    ]),
  );
  // Local Preview capability names are the same in 0.3 and 0.4; the version is
  // the whole signal. A client reporting the 0.3 generation of them is a client
  // that has not been rebuilt against the 0.4 message schema.
  const requiredPreviewCapabilityNames =
    requiredPreviewCapabilitiesByVersion[selectedVersion] ??
    requiredPreviewCapabilitiesV03;
  const missingPreviewCapabilities = requiredPreviewCapabilityNames.filter(
    (name) => previewCapabilities.get(name) !== selectedVersion,
  );
  if (missingPreviewCapabilities.length > 0) {
    return {
      delivery: "withhold",
      diagnostic: structuredDeliveryDiagnostic({
        code: "preview.unsupportedPreviewCapability",
        message: `The preview client does not support every required Local Preview capability at version ${selectedVersion}.`,
        recoveryMessage: `Update the preview client to support: ${missingPreviewCapabilities.join(", ")}@${selectedVersion}.`,
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
ajv.addSchema(paywallV04Schema);
ajv.addSchema(previewMessageSchema);
ajv.addSchema(previewMessageV04Schema);
const validatePaywallSchema = ajv.getSchema(paywallSchema.$id);
const validatePaywallV04Schema = ajv.getSchema(paywallV04Schema.$id);
const validatePreviewMessageSchema = ajv.getSchema(previewMessageSchema.$id);
const validatePreviewMessageV04Schema = ajv.getSchema(
  previewMessageV04Schema.$id,
);
const validateLocalProjectSchema = ajv.compile(localProjectSchema);
const validateLocalProjectV04Schema = ajv.compile(localProjectV04Schema);

if (
  !validatePaywallSchema ||
  !validatePaywallV04Schema ||
  !validatePreviewMessageSchema ||
  !validatePreviewMessageV04Schema
) {
  throw new Error("Canonical Mosaic schemas were not registered.");
}

/**
 * The canonical capability ordering, taken from the schema enum.
 *
 * `requiredCapabilities` is serialised in this order. Consumers must not
 * hand-maintain a copy: a divergence here is rejected at delivery rather than
 * caught by a typechecker.
 */
export const capabilityNames = Object.freeze([
  ...paywallSchema.$defs.capabilityName.enum,
]);

export const paywallContractVersion = paywallSchema.$defs.version.const;

export const capabilityByComponentType = Object.freeze({
  award: "component.award",
  button: "component.button",
  carousel: "component.carousel",
  featureList: "component.featureList",
  icon: "component.icon",
  image: "component.image",
  productBadge: "component.productBadge",
  productCard: "component.productCard",
  productSelector: "component.productSelector",
  scrollContainer: "layout.scrollContainer",
  socialProof: "component.socialProof",
  stack: "layout.stack",
  switch: "component.switch",
  tabs: "component.tabs",
  text: "component.text",
  timeline: "component.timeline",
  countdown: "component.countdown",
});

/**
 * Property names whose presence means a value carries an authored colour.
 *
 * Exported as the source the derivation itself reads -- `usesColor` builds its
 * lookup from this array, so an entry that is not consulted cannot exist.
 */
export const colorFieldNames = Object.freeze([
  "background",
  "color",
  "emptyColor",
  "filledColor",
  "markerColor",
  "offTrackColor",
  "onTrackColor",
  "productLabelColor",
  "runtimePriceColor",
  "selectedLabelColor",
  "textColor",
  "thumbColor",
]);

const colorFieldNameSet = new Set(colorFieldNames);

const countdownUnitOrder = Object.freeze({
  day: 0,
  hour: 1,
  minute: 2,
  second: 3,
});

/**
 * Localization keys the protocol consumes itself. Mirrors
 * `tools/validation-v0.3.mjs`; the two must agree, and a test asserts it.
 */
export const reservedAccessibilityKeys = Object.freeze({
  "mosaic.a11y.rating": Object.freeze({
    placeholders: Object.freeze(["{{ rating.value }}", "{{ rating.maximum }}"]),
    consumedBy: (entries) =>
      entries.some(({ node }) => node.type === "socialProof" && node.rating),
    consumer: "a Social Proof rating",
  }),
  "mosaic.a11y.in_progress": Object.freeze({
    placeholders: Object.freeze([]),
    consumedBy: (entries) =>
      entries.some(({ node }) => node.type === "button" && node.inProgressChildren),
    consumer: "Button in-progress content",
  }),
});

/**
 * A rating in points, as substituted into `{{ rating.value }}`. `value` counts
 * steps and `maximum` counts points, so announcing `value` directly says
 * "9 out of 5". Locale-independent by design -- see docs/protocol/v0.3.md.
 */
export function ratingPoints(rating) {
  const stepsPerPoint = rating.step === "half" ? 2 : 1;
  const points = rating.value / stepsPerPoint;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function ratingMaximumPoints(rating) {
  return String(rating.maximum);
}

export function resolveRatingAnnouncement(rating, template) {
  if (typeof template !== "string") {
    throw new TypeError(
      "A rating announcement requires the resolved mosaic.a11y.rating string.",
    );
  }
  for (const placeholder of reservedAccessibilityKeys["mosaic.a11y.rating"]
    .placeholders) {
    if (!template.includes(placeholder)) {
      throw new TypeError(
        `The mosaic.a11y.rating string is missing ${placeholder}.`,
      );
    }
  }
  return template
    .replaceAll("{{ rating.value }}", ratingPoints(rating))
    .replaceAll("{{ rating.maximum }}", ratingMaximumPoints(rating));
}

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
    } else if (node.type === "stack") {
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
    } else if (node.type === "tabs") {
      for (const [index, entry] of (node.tabs ?? []).entries()) {
        visit(
          entry.content,
          `${path}/tabs/${index}/content`,
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

  for (const [index, screen] of document.screens.entries()) {
    visit(screen.layout, `/screens/${index}/layout`, screen.id);
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

// ---------------------------------------------------------------------------
// Paywall Protocol 0.4 (draft): the motion contract.
//
// 0.4 is a draft and Studio does not author it yet, so the browser runtime
// exposes the part of it that has no 0.3 equivalent -- the motion vocabulary,
// its capability names, and the reference frame resolver -- rather than a
// second copy of the semantic validator whose rules 0.4 does not change.
// Adding full 0.4 browser validation later is additive and needs no contract
// version, exactly as it was for the Phase 9A billing contracts.
//
// `resolveMotionFrame` mirrors `resolveV04MotionFrame` in
// `tools/validation-v0.4.mjs`. A test drives every frame of every committed
// motion vector through both and asserts they are identical, so the mirror
// cannot drift without the protocol gate failing.
// ---------------------------------------------------------------------------

export const paywallV04ContractVersion = paywallV04Schema.$defs.version.const;
export const paywallContractVersions = Object.freeze(["0.3", "0.4"]);
export const paywallSchemasByVersion = Object.freeze({
  "0.3": paywallSchema,
  "0.4": paywallV04Schema,
});
export const paywallV04CapabilityNames = Object.freeze([
  ...paywallV04Schema.$defs.capabilityName.enum,
]);
export const motionCapabilityNames = Object.freeze([
  "motion.appear",
  "motion.selection",
  "motion.loop",
]);
export const motionEasingControlPoints = Object.freeze({
  linear: Object.freeze([0, 0, 1, 1]),
  standard: Object.freeze([0.4, 0, 0.2, 1]),
  decelerate: Object.freeze([0, 0, 0.2, 1]),
  accelerate: Object.freeze([0.4, 0, 1, 1]),
});
export const motionLoopMinimumDurationMilliseconds = 500;

function roundMotionValue(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function motionCubicBezierY(controlPoints, x) {
  const [x1, y1, x2, y2] = controlPoints;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const axis = (a, b) => (t) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  const curveX = axis(x1, x2);
  const curveY = axis(y1, y2);
  const slopeX = (t) =>
    3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2);

  let parameter = x;
  for (let step = 0; step < 8; step += 1) {
    const error = curveX(parameter) - x;
    if (Math.abs(error) < 1e-12) return curveY(parameter);
    const derivative = slopeX(parameter);
    if (Math.abs(derivative) < 1e-9) break;
    parameter -= error / derivative;
  }
  let low = 0;
  let high = 1;
  parameter = x;
  for (let step = 0; step < 64; step += 1) {
    const value = curveX(parameter);
    if (Math.abs(value - x) < 1e-12) break;
    if (value > x) high = parameter;
    else low = parameter;
    parameter = (low + high) / 2;
  }
  return curveY(parameter);
}

export function easedMotionProgress(easing, fraction) {
  const controlPoints = motionEasingControlPoints[easing];
  if (!controlPoints) {
    throw new TypeError(`Unknown Protocol 0.4 easing preset ${easing}.`);
  }
  return motionCubicBezierY(controlPoints, fraction);
}

export function resolveMotionToken(document, motion) {
  return resolveTokenValue(document, "motions", "motionToken", motion);
}

/** The motion capabilities a 0.4 document requires, in canonical order. */
export function motionCapabilitiesFor(document) {
  const derived = new Set();
  for (const { node } of walkDocumentNodes(document)) {
    if (node.motion?.appear) derived.add("motion.appear");
    if (node.motion?.selection) derived.add("motion.selection");
    if (node.motion?.loop) derived.add("motion.loop");
  }
  return motionCapabilityNames.filter((name) => derived.has(name));
}

const motionLiteralColor = /^#[0-9A-F]{8}$/;

function interpolateMotionColor(from, to, progress) {
  if (JSON.stringify(from) === JSON.stringify(to)) return structuredClone(to);
  if (typeof from !== "string" || typeof to !== "string") {
    return structuredClone(progress < 0.5 ? from : to);
  }
  if (!motionLiteralColor.test(from) || !motionLiteralColor.test(to)) {
    return progress < 0.5 ? from : to;
  }
  let mixed = "#";
  for (let offset = 1; offset < 9; offset += 2) {
    const start = Number.parseInt(from.slice(offset, offset + 2), 16);
    const end = Number.parseInt(to.slice(offset, offset + 2), 16);
    const channel = Math.round(start + (end - start) * progress);
    mixed += channel.toString(16).toUpperCase().padStart(2, "0");
  }
  return mixed;
}

function interpolateMotionNumber(from, to, progress) {
  return roundMotionValue(from + (to - from) * progress);
}

function interpolateMotionBackground(from, to, progress) {
  if (from?.type === "color" && to?.type === "color") {
    return {
      type: "color",
      value: interpolateMotionColor(from.value, to.value, progress),
    };
  }
  return structuredClone(progress < 0.5 ? from : to);
}

function interpolateMotionShadow(from, to, progress) {
  if (from?.type === "shadow" && to?.type === "shadow") {
    return {
      type: "shadow",
      color: interpolateMotionColor(from.color, to.color, progress),
      offsetX: interpolateMotionNumber(from.offsetX, to.offsetX, progress),
      offsetY: interpolateMotionNumber(from.offsetY, to.offsetY, progress),
      blurRadius: interpolateMotionNumber(
        from.blurRadius,
        to.blurRadius,
        progress,
      ),
    };
  }
  return structuredClone(progress < 0.5 ? from : to);
}

function interpolateMotionStyle(from, to, progress) {
  const style = {
    background: interpolateMotionBackground(
      from.background,
      to.background,
      progress,
    ),
    border: {
      color: interpolateMotionColor(from.border.color, to.border.color, progress),
      width: interpolateMotionNumber(from.border.width, to.border.width, progress),
    },
    cornerRadius: interpolateMotionNumber(
      from.cornerRadius,
      to.cornerRadius,
      progress,
    ),
    padding: structuredClone(progress < 0.5 ? from.padding : to.padding),
    opacity: interpolateMotionNumber(from.opacity, to.opacity, progress),
  };
  if (from.shadow !== undefined || to.shadow !== undefined) {
    style.shadow = interpolateMotionShadow(from.shadow, to.shadow, progress);
  }
  return style;
}

export function resolveMotionFrame(
  motion,
  { trigger, elapsedMilliseconds, reducedMotion = false, resolvedFrom, resolvedTo } = {},
) {
  if (!Number.isInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new TypeError(
      "Motion frame resolution requires a whole, non-negative elapsed time in milliseconds.",
    );
  }
  if (typeof reducedMotion !== "boolean") {
    throw new TypeError(
      "Motion frame resolution requires an explicit reduced-motion signal.",
    );
  }
  if (trigger !== "appear" && trigger !== "selection" && trigger !== "loop") {
    throw new TypeError(`Unknown Protocol 0.4 motion trigger ${trigger}.`);
  }
  const endpointsSupplied = resolvedFrom !== undefined || resolvedTo !== undefined;
  if (trigger === "selection" && (!resolvedFrom || !resolvedTo)) {
    throw new TypeError(
      "A selection frame requires resolvedFrom and resolvedTo styles.",
    );
  }
  if (trigger !== "selection" && endpointsSupplied) {
    throw new TypeError(
      `A ${trigger} frame does not interpolate between two styles; resolvedFrom and resolvedTo must be omitted.`,
    );
  }
  const curve = motion?.curve;
  if (curve?.type !== "motion") {
    throw new TypeError(
      "Motion frame resolution requires an inline curve; resolve motionToken references against the document first.",
    );
  }

  if (trigger === "appear") {
    if (motion.effect !== "fade" && motion.effect !== "fadeRise") {
      throw new TypeError(`Unknown Protocol 0.4 appear effect ${motion.effect}.`);
    }
    const rise = motion.effect === "fadeRise" ? motion.riseLogicalSize : 0;
    const start = motion.delayMilliseconds;
    const end = start + curve.durationMilliseconds;
    if (elapsedMilliseconds >= end) {
      return {
        trigger,
        reducedMotion,
        complete: true,
        progress: 1,
        opacity: 1,
        translateLogicalSize: 0,
      };
    }
    if (elapsedMilliseconds <= start) {
      return {
        trigger,
        reducedMotion,
        complete: false,
        progress: 0,
        opacity: 0,
        translateLogicalSize: reducedMotion ? 0 : roundMotionValue(rise),
      };
    }
    const progress = easedMotionProgress(
      curve.easing,
      (elapsedMilliseconds - start) / curve.durationMilliseconds,
    );
    return {
      trigger,
      reducedMotion,
      complete: false,
      progress: roundMotionValue(progress),
      opacity: roundMotionValue(progress),
      translateLogicalSize: reducedMotion
        ? 0
        : roundMotionValue(rise * (1 - progress)),
    };
  }

  if (trigger === "selection") {
    if (reducedMotion || elapsedMilliseconds >= curve.durationMilliseconds) {
      return {
        trigger,
        reducedMotion,
        complete: true,
        progress: 1,
        style: structuredClone(resolvedTo),
      };
    }
    const progress = easedMotionProgress(
      curve.easing,
      elapsedMilliseconds / curve.durationMilliseconds,
    );
    return {
      trigger,
      reducedMotion,
      complete: false,
      progress: roundMotionValue(progress),
      style: interpolateMotionStyle(resolvedFrom, resolvedTo, progress),
    };
  }

  if (motion.effect !== "pulse") {
    throw new TypeError(`Unknown Protocol 0.4 loop effect ${motion.effect}.`);
  }
  const cycleMilliseconds = curve.durationMilliseconds;
  const totalMilliseconds = cycleMilliseconds * motion.repeat.count;
  const atRest = {
    trigger,
    reducedMotion,
    complete: true,
    cycle: motion.repeat.count,
    cyclePhase: 0,
    excursion: 0,
    scale: 1,
    opacityMultiplier: 1,
  };
  if (reducedMotion) return { ...atRest, cycle: 0 };
  if (elapsedMilliseconds >= totalMilliseconds) return atRest;
  const cycle = Math.floor(elapsedMilliseconds / cycleMilliseconds);
  const cyclePhase =
    (elapsedMilliseconds - cycle * cycleMilliseconds) / cycleMilliseconds;
  const halfPhase = cyclePhase < 0.5 ? cyclePhase * 2 : (1 - cyclePhase) * 2;
  const excursion = easedMotionProgress(curve.easing, halfPhase);
  return {
    trigger,
    reducedMotion,
    complete: false,
    cycle,
    cyclePhase: roundMotionValue(cyclePhase),
    excursion: roundMotionValue(excursion),
    scale: roundMotionValue(1 + motion.scaleAmplitude * excursion),
    opacityMultiplier: roundMotionValue(1 - motion.opacityAmplitude * excursion),
  };
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
    tabs: Object.fromEntries(
      entries
        .filter(({ node }) => node.type === "tabs")
        .map(({ node }) => [node.id, node.initialTabId]),
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

/**
 * Selection state a conditional-visibility decision depends on.
 *
 * `selectionState` carries `{ switches, tabs }`. A condition whose controller
 * is absent from the state it was handed throws rather than resolving: an
 * unknown Switch compared with `===` reads back as `false`, and `false` is a
 * component that silently disappears.
 */
export function evaluateVisibility(visibility, selectionState = {}) {
  if (!visibility || visibility.mode === "always") return true;
  if (visibility.mode === "hidden") return false;
  if (visibility.mode === "switch") {
    const switches = selectionState.switches;
    if (!switches || !Object.hasOwn(switches, visibility.switchId)) {
      throw new TypeError(
        `Visibility depends on Switch ${visibility.switchId}, which the supplied runtime state does not carry.`,
      );
    }
    return switches[visibility.switchId] === visibility.equals;
  }
  const tabs = selectionState.tabs;
  if (!tabs || !Object.hasOwn(tabs, visibility.tabsId)) {
    throw new TypeError(
      `Visibility depends on Tabs ${visibility.tabsId}, which the supplied runtime state does not carry.`,
    );
  }
  return tabs[visibility.tabsId] === visibility.equals;
}

export function paywallRuntimeDiagnostics(
  document,
  selectionState,
  navigationState,
) {
  if (document?.schemaVersion !== "0.3") {
    // Returning no diagnostics here would read as "nothing is wrong with this
    // document", which is the opposite of what an unreadable version means.
    throw new TypeError(
      "Runtime diagnostics require a Paywall Protocol 0.3 document.",
    );
  }
  const entries = walkDocumentNodes(document);
  const accepted = runtimeStateForAcceptedRevision(document);
  const values =
    selectionState ?? { switches: accepted.switches, tabs: accepted.tabs };
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
  // An unparsable deadline is exactly as unresolvable as an invalid clock, and
  // must fail the same way. Left to arithmetic it yields NaN, which reads back
  // as `completed: false` -- an offer that never expires and never counts down.
  const endsAtMilliseconds = Date.parse(countdown.endsAt);
  if (!Number.isFinite(endsAtMilliseconds)) {
    throw new TypeError("Countdown resolution requires a valid endsAt deadline.");
  }
  const remainingMilliseconds = Math.max(endsAtMilliseconds - nowMilliseconds, 0);
  return {
    completed: remainingMilliseconds === 0,
    remainingMilliseconds,
    largestUnit: countdown.largestUnit,
    smallestUnit: countdown.smallestUnit,
    completedText: countdown.completedText,
  };
}

/**
 * The strings a requested locale resolves to, per the documented candidate
 * chain: the requested tag, its base language, `fallbackLocale`, then
 * `defaultLocale`. A key missing from the first declared catalog falls through
 * the remaining candidates -- catalogs are partial by design, so this is a
 * declared lookup order and not a fallback that hides missing data.
 */
export function resolvedCatalogStrings(localization, requestedLocale) {
  const candidates = [];
  for (const candidate of [
    requestedLocale,
    typeof requestedLocale === "string" ? requestedLocale.split("-")[0] : null,
    localization.fallbackLocale,
    localization.defaultLocale,
  ]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  const declared = candidates.filter((candidate) =>
    Object.hasOwn(localization.locales, candidate),
  );
  if (declared.length === 0) {
    throw new TypeError(
      `No declared catalog matches requested locale ${requestedLocale}.`,
    );
  }
  const strings = {};
  for (const candidate of [...declared].reverse()) {
    Object.assign(strings, localization.locales[candidate].strings);
  }
  return strings;
}

/**
 * Resolves one localized string from an explicit catalog.
 *
 * Throws rather than falling back to the inline `default`. These are
 * conformance vectors: a missing key must fail loudly here, not quietly pin an
 * announcement that a real renderer would resolve differently.
 */
function catalogString(strings, key) {
  if (!Object.hasOwn(strings, key)) {
    throw new TypeError(`The resolved catalog does not declare ${key}.`);
  }
  return strings[key];
}

/**
 * The accessibility announcement contract for one component.
 *
 * Renderers do not join segments. Each announced segment is its own
 * accessibility element inside a labelled container, in the order returned
 * here, and the platform inserts whatever pause or punctuation its locale and
 * screen reader use. A renderer that concatenates segments with `". "` has
 * invented script-specific punctuation exactly the way a hardcoded "out of"
 * invents a word -- it just looks innocuous because it is punctuation.
 *
 * `separator` is `null` by contract and is present in the returned shape so
 * that "no joining happens" is a value a conformance vector can assert rather
 * than an absence a reader has to infer.
 */
export function accessibilityAnnouncement(node, { strings, state = null } = {}) {
  if (!strings || typeof strings !== "object") {
    throw new TypeError("An announcement requires the resolved locale catalog.");
  }
  const text = (localizedText) => catalogString(strings, localizedText.localizationKey);
  const elements = [];
  const decorative = [];

  if (node.type === "button") {
    if (state !== "idle" && state !== "inProgress") {
      throw new TypeError(
        `Button announcement requires state "idle" or "inProgress", got ${state}.`,
      );
    }
    // A Button is one control. Its name is authored and does not change when it
    // becomes busy -- a name that changes mid-operation is disorienting and
    // breaks UI automation -- so busy-ness is carried as the control's value.
    for (const child of state === "inProgress"
      ? (node.inProgressChildren ?? [])
      : node.children) {
      decorative.push(child.id);
    }
    return {
      composition: "singleElement",
      separator: null,
      container: {
        role: "button",
        label: text(node.accessibility.label),
        value:
          state === "inProgress"
            ? catalogString(strings, "mosaic.a11y.in_progress")
            : null,
        hint: node.accessibility.hint ? text(node.accessibility.hint) : null,
      },
      elements,
      decorative,
    };
  }

  if (node.type === "socialProof") {
    if (node.rating) {
      elements.push({
        segment: "rating",
        text: resolveRatingAnnouncement(
          node.rating,
          catalogString(strings, "mosaic.a11y.rating"),
        ),
      });
    }
    elements.push({ segment: "quote", text: text(node.quote) });
    elements.push({ segment: "attribution", text: text(node.attribution) });
    if (node.avatar) decorative.push("avatar");
  } else if (node.type === "award") {
    elements.push({ segment: "title", text: text(node.title) });
    if (node.subtitle) {
      elements.push({ segment: "subtitle", text: text(node.subtitle) });
    }
    if (node.emblem) decorative.push("emblem");
  } else if (node.type === "timeline") {
    for (const entry of node.entries) {
      elements.push({ item: entry.id, segment: "title", text: text(entry.title) });
      if (entry.description) {
        elements.push({
          item: entry.id,
          segment: "description",
          text: text(entry.description),
        });
      }
      if (entry.marker) decorative.push(`${entry.id}.marker`);
    }
    decorative.push("connector");
  } else {
    throw new TypeError(
      `${node.type} has no composed announcement contract in Protocol 0.3.`,
    );
  }

  return {
    composition: "separateElements",
    separator: null,
    container: {
      role: node.type === "timeline" ? "list" : "group",
      label: text(node.accessibility.label),
      value: null,
      hint: node.accessibility.hint ? text(node.accessibility.hint) : null,
    },
    elements,
    decorative,
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

/**
 * Whether a value carries an authored colour anywhere inside it.
 *
 * This is the predicate `style.colors` derivation runs, exported so a consumer
 * can ask rather than reimplement the field list.
 */
export function usesColor(value) {
  let found = false;
  walkObjectValues(value, (entry) => {
    if (entry.type === "colorToken") found = true;
    if (
      Object.entries(entry).some(
        ([key, fieldValue]) =>
          colorFieldNameSet.has(key) && fieldValue !== undefined,
      )
    ) {
      found = true;
    }
  });
  return found;
}

const objectUsesColor = usesColor;

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
  return nodeEntries.some(({ node, ancestors }) =>
    (node.type === "text" &&
      ancestors.some((ancestor) => ancestor.type === "productCard") &&
      localizedTextUsesProductTemplate(document, node.value)) ||
    (node.type === "productCard" &&
      node.accessibility?.label &&
      localizedTextUsesProductTemplate(document, node.accessibility.label)),
  );
}

function deriveDocumentCapabilities(document, nodeEntries) {
  const capabilities = new Set(["localization.catalogs"]);

  capabilities.add("navigation.screens");
  if (document.screens.some((screen) => screen.presentation?.type === "sheet")) {
    capabilities.add("navigation.sheets");
  }
  if (documentUsesProductTemplates(document, nodeEntries)) {
    capabilities.add("localization.productTemplate");
  }
  if (
    Object.values(reservedAccessibilityKeys).some((reserved) =>
      reserved.consumedBy(nodeEntries),
    )
  ) {
    capabilities.add("accessibility.reservedStrings");
  }

  if (
    Object.values(document.localization.locales).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    capabilities.add("localization.rtl");
  }
  if (document.products.length > 0) capabilities.add("product.references");
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

  for (const { node } of nodeEntries) {
    const capability = capabilityByComponentType[node.type];
    if (capability) capabilities.add(capability);
    if (node.accessibility || node.type === "carousel") {
      capabilities.add("accessibility.metadata");
    }
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
    } else if (node.visibility?.mode === "tab") {
      capabilities.add("condition.tabVisibility");
    } else if (node.visibility) {
      capabilities.add("visibility.static");
    }
    if (objectUsesColor(node)) capabilities.add("style.colors");
    if (node.type === "productSelector") {
      capabilities.add("fallback.product");
      capabilities.add("outcome.normalized");
      capabilities.add("style.productCardStates");
    }
    if (node.type === "productCard" || node.type === "productBadge") {
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

/**
 * The capabilities a 0.4 document requires.
 *
 * A delta over the 0.3 derivation rather than a second copy of it, because
 * "0.4 is 0.3 plus motion minus one co-derived capability" is the whole
 * compatibility claim, and a copy would let the two answers drift while each
 * stayed internally consistent. It mirrors `expectedV04DocumentCapabilities` in
 * `tools/validation-v0.4.mjs`, and the browser/Node agreement test drives a 0.4
 * document through both validators.
 */
function deriveV04DocumentCapabilities(document, nodeEntries) {
  const capabilities = deriveDocumentCapabilities(document, nodeEntries);
  capabilities.delete("style.productCardStates");
  for (const { node } of nodeEntries) {
    if (node.motion?.appear) capabilities.add("motion.appear");
    if (node.motion?.selection) capabilities.add("motion.selection");
    if (node.motion?.loop) capabilities.add("motion.loop");
  }
  return capabilities;
}

/**
 * The 0.4 rules that have no 0.3 equivalent.
 *
 * Deliberately asymmetric with the colour, background, and shadow catalogs: an
 * unreferenced colour is inert, but an unreferenced motion is a duration whose
 * flash safety is checked at its *reference* site, so a token nothing
 * references has never been checked against anything and sits in the catalog
 * looking approved. See docs/protocol/v0.4.md.
 */
function addV04MotionDiagnostics(diagnostics, document, nodeEntries) {
  const catalog = document.designSystem.motions;
  const declared = new Set(catalog.map((token) => token.id));

  // Only a *node* reference site makes a token used. Walking the catalog as a
  // usage root -- which the unknown-reference check above does, and must --
  // lets a token vouch for the token it names, so a pair of orphans that
  // reference each other would report itself as used.
  const nodeReferenced = new Set();
  for (const { node } of nodeEntries) {
    walkObjectValues(node, (value) => {
      if (value.type === "motionToken" && declared.has(value.id)) {
        nodeReferenced.add(value.id);
      }
    });
  }
  const graph = new Map(catalog.map((token) => [token.id, new Set()]));
  for (const token of catalog) {
    walkObjectValues(token.value, (value) => {
      if (value.type === "motionToken") graph.get(token.id).add(value.id);
    });
  }
  // Transitive reachability from those sites: a token reached only through
  // another *used* token is used, one reached only through an unused token is
  // not. The visited set also terminates a cycle among unreachable tokens,
  // which the cycle rule reports separately.
  const reachable = new Set();
  const pending = [...nodeReferenced];
  while (pending.length > 0) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const target of graph.get(id) ?? []) pending.push(target);
  }
  for (const [index, token] of catalog.entries()) {
    if (reachable.has(token.id)) continue;
    diagnostics.push(
      diagnostic({
        code: "semantic.unusedDeclaration",
        message: `Motion token ${token.id} is declared but never referenced.`,
        documentPath: `/designSystem/motions/${index}`,
        property: "motions",
        recoveryMessage:
          "Reference the motion where it is used, or remove it from the catalog.",
        document,
      }),
    );
  }

  const loopsByScreen = new Map();
  for (const { node, path, screenId, ancestors } of nodeEntries) {
    const motion = node.motion;
    if (!motion) continue;

    if (motion.appear) {
      const animatedAncestor = ancestors.find(
        (ancestor) => ancestor.motion?.appear,
      );
      if (animatedAncestor) {
        // Two entrance opacities multiply, and three renderers compose that
        // product at different points in their pipelines.
        diagnostics.push(
          diagnostic({
            code: "semantic.motion",
            message: `${node.id} declares appear motion inside ${animatedAncestor.id}, which already declares one.`,
            documentPath: `${path}/motion/appear`,
            componentId: node.id,
            property: "motion",
            recoveryMessage:
              "Put the entrance on the group you want to animate, not on both.",
            document,
          }),
        );
      }
    }

    if (!motion.loop) continue;
    loopsByScreen.set(screenId, [
      ...(loopsByScreen.get(screenId) ?? []),
      { node, path },
    ]);
    const resolved = resolveMotionToken(document, motion.loop.curve);
    if (!resolved) continue;
    if (resolved.durationMilliseconds >= motionLoopMinimumDurationMilliseconds) {
      continue;
    }
    diagnostics.push(
      diagnostic({
        code: "semantic.motion",
        message: `Loop motion on ${node.id} resolves to ${resolved.durationMilliseconds}ms, below the ${motionLoopMinimumDurationMilliseconds}ms flash-safety floor.`,
        documentPath: `${path}/motion/loop/curve`,
        componentId: node.id,
        property: "motion",
        recoveryMessage: `Use a motion of at least ${motionLoopMinimumDurationMilliseconds}ms for a looping pulse.`,
        document,
      }),
    );
  }
  for (const [screenId, entries] of loopsByScreen) {
    if (entries.length <= 1) continue;
    for (const entry of entries.slice(1)) {
      diagnostics.push(
        diagnostic({
          code: "semantic.motion",
          message: `Screen ${screenId} declares loop motion on more than one button.`,
          documentPath: `${entry.path}/motion/loop`,
          componentId: entry.node.id,
          property: "motion",
          recoveryMessage: "Keep at most one looping call to action per screen.",
          document,
        }),
      );
    }
  }
}

/**
 * The capability names a document requires, in canonical order.
 *
 * The single reference implementation. Studio serialises
 * `compatibility.requiredCapabilities` from this; the three SDKs compare
 * against it. Nothing else should derive capabilities by hand -- an
 * over-declared or under-declared capability is rejected at delivery, and the
 * validator/browser capability tables had already drifted apart once.
 */
export function expectedDocumentCapabilities(document) {
  const derived = deriveDocumentCapabilities(
    document,
    walkDocumentNodes(document),
  );
  return capabilityNames.filter((name) => derived.has(name));
}

/** The same set, shaped for `compatibility.requiredCapabilities`. */
export function requiredCapabilitiesFor(document) {
  return expectedDocumentCapabilities(document).map((name) => ({
    name,
    version: paywallContractVersion,
  }));
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

const designSystemCategoryByTokenType = Object.freeze({
  colorToken: "colors",
  backgroundToken: "backgrounds",
  shadowToken: "shadows",
  motionToken: "motions",
});

function semanticPaywallDiagnostics(document, version = paywallContractVersion) {
  const diagnostics = [];
  const isV04 = version === paywallV04ContractVersion;
  const manifest = isV04 ? compatibilityManifestV04 : compatibilityManifest;
  const nodeEntries = walkDocumentNodes(document);
  const expectedCapabilities = isV04
    ? deriveV04DocumentCapabilities(document, nodeEntries)
    : deriveDocumentCapabilities(document, nodeEntries);
  const declaredCapabilities = document.compatibility.requiredCapabilities;
  const declaredByName = new Map();
  const supportedByName = new Map(
    manifest.capabilities.map((capability) => [
      capability.name,
      capability.version,
    ]),
  );

  const catalogs = {
    colorToken: document.designSystem.colors,
    backgroundToken: document.designSystem.backgrounds,
    shadowToken: document.designSystem.shadows,
    ...(isV04 ? { motionToken: document.designSystem.motions } : {}),
  };
  for (const [type, catalog] of Object.entries(catalogs)) {
    const category = designSystemCategoryByTokenType[type];
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

  addDuplicateDiagnostics({
    diagnostics,
    entries: document.screens,
    field: "id",
    path: "/screens",
    label: "Screen catalog",
    document,
  });

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
    if (node.type === "tabs") {
      for (const [index, tab] of node.tabs.entries()) {
        if (seenNodeIds.has(tab.id)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.duplicateIdentifier",
              message: `Layout tree contains duplicate id ${tab.id}.`,
              documentPath: `${path}/tabs/${index}/id`,
              componentId: node.id,
              property: "id",
              document,
            }),
          );
        }
        seenNodeIds.add(tab.id);
      }
    }
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
    if (node.type === "timeline") {
      addDuplicateDiagnostics({
        diagnostics,
        entries: node.entries,
        field: "id",
        path: `${path}/entries`,
        label: `Timeline ${node.id}`,
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
  // Every place a component names an image asset. A component added without an
  // entry here would have its asset go uncounted and then be reported unused.
  const imageAssetReferences = (node, path) => {
    if (node.type === "image") {
      return [{ assetId: node.assetId, path: `${path}/assetId`, property: "assetId", label: `Image ${node.id}` }];
    }
    if (node.type === "award" && node.emblem?.type === "image") {
      return [{ assetId: node.emblem.assetId, path: `${path}/emblem/assetId`, property: "assetId", label: `Award ${node.id} emblem` }];
    }
    if (node.type === "socialProof" && node.avatar) {
      return [{ assetId: node.avatar.assetId, path: `${path}/avatar/assetId`, property: "assetId", label: `Social proof ${node.id} avatar` }];
    }
    return [];
  };
  for (const { node, path } of nodeEntries) {
    for (const reference of imageAssetReferences(node, path)) {
      const asset = assetsById.get(reference.assetId);
      if (!asset || asset.type !== "image") {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `${reference.label} references unknown asset ${reference.assetId}.`,
            documentPath: reference.path,
            componentId: node.id,
            property: reference.property,
            recoveryAction: "editProperty",
            recoveryMessage: "Choose a declared bundled image asset.",
            document,
          }),
        );
      }
      referencedAssets.add(reference.assetId);
    }
  }
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
      const references = node.cards.map((card) => card.productReferenceId);
      const selectorReferences = new Set();
      for (const [index, referenceId] of references.entries()) {
        if (!productsById.has(referenceId)) {
          diagnostics.push(
            diagnostic({
              code: "semantic.invalidReference",
              message: `Product selector ${node.id} references unknown product ${referenceId}.`,
              documentPath: `${path}/cards/${index}/productReferenceId`,
              componentId: node.id,
              property: "productReferenceId",
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
      const initialIsValid = node.cards.some(
        (card) => card.id === node.initialProductCardId,
      );
      if (!initialIsValid) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `Product selector ${node.id} initially selects an unlisted Product Card.`,
            documentPath: `${path}/initialProductCardId`,
            componentId: node.id,
            property: "initialProductCardId",
            recoveryAction: "bindProduct",
            recoveryMessage: "Choose one of the products bound to this selector.",
            document,
          }),
        );
      }
    }
    if (node.type === "button" && node.action.type === "purchase") {
      purchaseSelectorIds.add(`${screenId}:${node.action.productSelectorId}`);
    }
  }
  for (const { node, path, screenId } of nodeEntries) {
    if (node.type !== "button" || node.action.type !== "purchase") continue;
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
    } else if (selectorEntry.screenId !== screenId) {
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
    if (!purchaseSelectorIds.has(`${selectorEntry.screenId}:${selectorId}`)) {
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
    collectLocalizedText(document.screens, "/screens", localizedEntries);
    const referencedKeys = new Set();
    const defaultStrings = locales[defaultLocale].strings;
    const templateAllowed = new Set();
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
    for (const [key, reserved] of Object.entries(reservedAccessibilityKeys)) {
      const consumed = reserved.consumedBy(nodeEntries);
      const declared = Object.hasOwn(defaultStrings, key);
      if (consumed !== declared) {
        diagnostics.push(
          diagnostic({
            code: "semantic.reservedLocalization",
            message: consumed
              ? `Reserved key ${key} must be declared because the document contains ${reserved.consumer}.`
              : `Reserved key ${key} is declared but the document contains nothing that announces it.`,
            documentPath: `/localization/locales/${escapePointer(defaultLocale)}/strings`,
            property: "strings",
            document,
          }),
        );
      }
      if (!declared) continue;
      for (const [locale, catalog] of Object.entries(locales)) {
        const value = catalog.strings[key];
        if (value === undefined) continue;
        const path = `/localization/locales/${escapePointer(locale)}/strings/${escapePointer(key)}`;
        for (const placeholder of reserved.placeholders) {
          if (value.split(placeholder).length - 1 !== 1) {
            diagnostics.push(
              diagnostic({
                code: "semantic.reservedLocalization",
                message: `Reserved key ${key} must contain ${placeholder} exactly once.`,
                documentPath: path,
                property: "strings",
                document,
              }),
            );
          }
        }
        const residue = reserved.placeholders.reduce(
          (text, placeholder) => text.replaceAll(placeholder, ""),
          value,
        );
        if (residue.includes("{{") || residue.includes("}}")) {
          diagnostics.push(
            diagnostic({
              code: "semantic.reservedLocalization",
              message: `Reserved key ${key} contains an unsupported template expression.`,
              documentPath: path,
              property: "strings",
              document,
            }),
          );
        }
      }
    }
    for (const key of Object.keys(defaultStrings)) {
      // Reserved keys are consumed by the protocol, not referenced by a
      // component, so the unused sweep would flag every one of them.
      if (Object.hasOwn(reservedAccessibilityKeys, key)) continue;
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
  const tabsById = new Map(
    nodeEntries
      .filter(({ node }) => node.type === "tabs")
      .map((entry) => [entry.node.id, entry]),
  );
  const interactiveButtonDescendants = new Set([
    "button",
    "productSelector",
    "switch",
    "carousel",
    "tabs",
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
    if (node.type === "tabs") {
      addDuplicateDiagnostics({
        diagnostics,
        entries: node.tabs,
        field: "id",
        path: `${path}/tabs`,
        label: `Tabs ${node.id}`,
        document,
        componentId: node.id,
      });
      if (!node.tabs.some((tab) => tab.id === node.initialTabId)) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: "Tabs initialTabId must name one of its declared tabs.",
            documentPath: `${path}/initialTabId`,
            componentId: node.id,
            property: "initialTabId",
            document,
          }),
        );
      }
    }
    if (node.type === "timeline") {
      const marked = node.entries.some((entry) => entry.marker);
      const described = node.entries.some((entry) => entry.description);
      for (const [field, used] of [
        ["markerColor", marked],
        ["markerSize", marked],
        ["descriptionTypography", described],
      ]) {
        const declared = Object.hasOwn(node, field);
        if (used === declared) continue;
        diagnostics.push(
          diagnostic({
            code: "semantic.layout",
            message: used
              ? `Timeline must declare ${field}.`
              : `Timeline declares ${field} but no entry uses it.`,
            documentPath: `${path}/${field}`,
            componentId: node.id,
            property: field,
            document,
          }),
        );
      }
    }
    if (node.type === "socialProof" && node.rating) {
      const maximumSteps =
        node.rating.maximum * (node.rating.step === "half" ? 2 : 1);
      if (node.rating.value > maximumSteps) {
        diagnostics.push(
          diagnostic({
            code: "semantic.ratingBounds",
            message: `Social proof rating value ${node.rating.value} exceeds ${maximumSteps} ${node.rating.step} steps out of ${node.rating.maximum}.`,
            documentPath: `${path}/rating/value`,
            componentId: node.id,
            property: "value",
            document,
          }),
        );
      }
    }
    if (node.visibility?.mode === "tab") {
      const controller = tabsById.get(node.visibility.tabsId);
      if (!controller) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `Visibility references unknown tabs ${node.visibility.tabsId}.`,
            documentPath: `${path}/visibility/tabsId`,
            componentId: node.id,
            property: "tabsId",
            document,
          }),
        );
      } else if (controller.screenId !== screenId) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: "Visibility must reference a Tabs component on the same screen.",
            documentPath: `${path}/visibility/tabsId`,
            componentId: node.id,
            property: "tabsId",
            document,
          }),
        );
      } else if (
        controller.node.id === node.id ||
        ancestors.some((ancestor) => ancestor === controller.node)
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message:
              "Visibility cannot reference the Tabs component the node belongs to.",
            documentPath: `${path}/visibility/tabsId`,
            componentId: node.id,
            property: "tabsId",
            document,
          }),
        );
      } else if (
        !controller.node.tabs.some((tab) => tab.id === node.visibility.equals)
      ) {
        diagnostics.push(
          diagnostic({
            code: "semantic.invalidReference",
            message: `Visibility references unknown tab ${node.visibility.equals} of tabs ${controller.node.id}.`,
            documentPath: `${path}/visibility/equals`,
            componentId: node.id,
            property: "equals",
            document,
          }),
        );
      }
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

  if (isV04) addV04MotionDiagnostics(diagnostics, document, nodeEntries);

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

/**
 * The contract version a value claims, defaulting to the release candidate.
 *
 * Anything that is not an explicit `0.4` claim is read as `0.3`, so a value
 * with a missing, malformed, or unknown `schemaVersion` produces exactly the
 * 0.3 schema diagnostics it produced before 0.4 existed. Dispatching on the
 * claim rather than on shape matters because 0.4 is a superset: a 0.3 document
 * validated against the 0.4 schema would be rejected only by its version
 * `const`, which is a confusing way to say "this reader is newer than you".
 */
export function paywallDocumentVersion(value) {
  return isRecord(value) && value.schemaVersion === paywallV04ContractVersion
    ? paywallV04ContractVersion
    : paywallContractVersion;
}

export function validatePaywallDocument(value) {
  const version = paywallDocumentVersion(value);
  const schemaErrors = schemaDiagnostics(
    version === paywallV04ContractVersion
      ? validatePaywallV04Schema
      : validatePaywallSchema,
    value,
  );
  if (schemaErrors.length > 0) return failure(schemaErrors);

  const semanticErrors = semanticPaywallDiagnostics(value, version);
  return semanticErrors.length > 0 ? failure(semanticErrors) : success(value);
}

export function validatePreviewMessage(value, options = {}) {
  const previewVersion =
    isRecord(value) &&
    value.previewProtocolVersion === localPreviewV04ContractVersion
      ? localPreviewV04ContractVersion
      : localPreviewContractVersion;
  const schemaErrors = schemaDiagnostics(
    previewVersion === localPreviewV04ContractVersion
      ? validatePreviewMessageV04Schema
      : validatePreviewMessageSchema,
    value,
  );
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
  const schemaErrors = schemaDiagnostics(
    isRecord(value) && value.fileFormatVersion === localPreviewV04ContractVersion
      ? validateLocalProjectV04Schema
      : validateLocalProjectSchema,
    value,
  );
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
