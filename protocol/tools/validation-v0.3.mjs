import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const protocolV03Root = resolve(toolsDirectory, "..");

export const protocolV03Paths = Object.freeze({
  canonicalFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/complete-paywall.json",
  ),
  edgeFixture: resolve(protocolV03Root, "fixtures/v0.3/edge-cases.json"),
  expiredCountdownFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/expired-countdown.json",
  ),
  hiddenPurchaseTargetFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/hidden-purchase-target.json",
  ),
  navigationOnlyFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/navigation-only.json",
  ),
  invalidFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/noncanonical-color.json",
  ),
  invalidExternalUrlFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/insecure-external-url.json",
  ),
  invalidInteractiveButtonChildFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/interactive-button-child.json",
  ),
  invalidNavigationCycleFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/navigation-cycle.json",
  ),
  invalidProductCardOwnershipFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/product-card-outside-selector.json",
  ),
  invalidProductCardDefaultFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/incomplete-product-card-default.json",
  ),
  invalidDuplicateProductReferenceFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/duplicate-product-reference.json",
  ),
  invalidInteractiveProductCardChildFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/interactive-product-card-child.json",
  ),
  invalidUnsafeProductTemplateFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/unsafe-product-template.json",
  ),
  invalidUnknownTabVisibilityFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/unknown-tab-visibility.json",
  ),
  invalidTimelineUnusedMarkerStyleFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/timeline-unused-marker-style.json",
  ),
  invalidSocialProofOverratedFixture: resolve(
    protocolV03Root,
    "fixtures/v0.3/invalid/social-proof-overrated.json",
  ),
  ratingAnnouncementVectors: resolve(
    protocolV03Root,
    "fixtures/v0.3/rating-announcement.json",
  ),
  accessibilityAnnouncementVectors: resolve(
    protocolV03Root,
    "fixtures/v0.3/accessibility-announcement.json",
  ),
  compatibilityManifest: resolve(protocolV03Root, "compatibility/v0.3.json"),
  compatibilityManifestSchema: resolve(
    protocolV03Root,
    "schema/v0.3/compatibility-manifest.schema.json",
  ),
  paywallSchema: resolve(protocolV03Root, "schema/v0.3/paywall.schema.json"),
});

const capabilityByType = Object.freeze({
  award: "component.award",
  button: "component.button",
  carousel: "component.carousel",
  countdown: "component.countdown",
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
});

const requiredCanonicalComponentTypes = Object.freeze([
  "award",
  "button",
  "carousel",
  "countdown",
  "featureList",
  "icon",
  "image",
  "productBadge",
  "productCard",
  "productSelector",
  "socialProof",
  "switch",
  "tabs",
  "text",
  "timeline",
]);

const colorFieldNames = new Set([
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

const eligibleSizingTypes = new Set([
  "award",
  "button",
  "carousel",
  "countdown",
  "featureList",
  "icon",
  "image",
  "productBadge",
  "productCard",
  "productSelector",
  "socialProof",
  "stack",
  "switch",
  "tabs",
  "text",
  "timeline",
]);

const countdownUnitOrder = Object.freeze({
  day: 0,
  hour: 1,
  minute: 2,
  second: 3,
});

/**
 * Localization keys the protocol consumes itself.
 *
 * A renderer must never compose an accessibility phrase from a string literal
 * in any language -- the fallback audit found hardcoded English shipping to
 * production on two platforms ("Paywall unavailable", "In progress"). These
 * keys are how the phrasing gets authored and translated instead.
 *
 * `consumedBy` decides presence in both directions: required when the document
 * contains the feature that reads the key, forbidden when it does not, so a key
 * can neither be missing where it is announced nor linger where nothing reads
 * it. `placeholders` must each appear exactly once in every declared
 * translation, because a translation that drops one silently announces a
 * rating with no number in it.
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
 * A rating in points, as the string substituted into `{{ rating.value }}`.
 *
 * `value` counts steps and `maximum` counts points, so announcing `value`
 * directly says "9 out of 5". The conversion is exact: `value` is an integer
 * and there are one or two steps per point, so the result is a whole number or
 * a whole number and a half, and never needs rounding.
 *
 * The form is deliberately locale-independent -- ASCII digits, `.` as the
 * decimal separator, no grouping, one fraction digit only for a half step.
 * Three renderers must produce the same bytes for the conformance vectors to
 * mean anything, and platform number formatters disagree about fraction digits
 * and separators across OS versions. All locale variation lives in the authored
 * template instead. Locale-aware numerals are a deferred protocol change.
 */
export function v03RatingPoints(rating) {
  const stepsPerPoint = rating.step === "half" ? 2 : 1;
  const points = rating.value / stepsPerPoint;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function v03RatingMaximumPoints(rating) {
  return String(rating.maximum);
}

/**
 * The exact string a renderer announces for a rating.
 *
 * `template` is the resolved `mosaic.a11y.rating` string for the resolved
 * catalog locale. Substitution is closed to the two reserved placeholders; the
 * template is authored copy and nothing else in it is interpreted.
 */
export function resolveV03RatingAnnouncement(rating, template) {
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
    .replaceAll("{{ rating.value }}", v03RatingPoints(rating))
    .replaceAll("{{ rating.maximum }}", v03RatingMaximumPoints(rating));
}

const externalUrlPattern =
  /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$/u;
const productTemplatePattern = /\{\{\s*product\.(name|price)\s*\}\}/gu;

export function readV03Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadProtocolV03Artifacts() {
  return {
    document: readV03Json(protocolV03Paths.canonicalFixture),
    edgeDocument: readV03Json(protocolV03Paths.edgeFixture),
    expiredCountdownDocument: readV03Json(
      protocolV03Paths.expiredCountdownFixture,
    ),
    hiddenPurchaseTargetDocument: readV03Json(
      protocolV03Paths.hiddenPurchaseTargetFixture,
    ),
    navigationOnlyDocument: readV03Json(
      protocolV03Paths.navigationOnlyFixture,
    ),
    invalidDocument: readV03Json(protocolV03Paths.invalidFixture),
    invalidDocuments: [
      readV03Json(protocolV03Paths.invalidFixture),
      readV03Json(protocolV03Paths.invalidExternalUrlFixture),
      readV03Json(protocolV03Paths.invalidInteractiveButtonChildFixture),
      readV03Json(protocolV03Paths.invalidNavigationCycleFixture),
      readV03Json(protocolV03Paths.invalidProductCardOwnershipFixture),
      readV03Json(protocolV03Paths.invalidProductCardDefaultFixture),
      readV03Json(protocolV03Paths.invalidDuplicateProductReferenceFixture),
      readV03Json(protocolV03Paths.invalidInteractiveProductCardChildFixture),
      readV03Json(protocolV03Paths.invalidUnsafeProductTemplateFixture),
      readV03Json(protocolV03Paths.invalidUnknownTabVisibilityFixture),
      readV03Json(protocolV03Paths.invalidTimelineUnusedMarkerStyleFixture),
      readV03Json(protocolV03Paths.invalidSocialProofOverratedFixture),
    ],
    manifest: readV03Json(protocolV03Paths.compatibilityManifest),
    manifestSchema: readV03Json(protocolV03Paths.compatibilityManifestSchema),
    paywallSchema: readV03Json(protocolV03Paths.paywallSchema),
  };
}

function createSchemaValidators({ manifestSchema, paywallSchema }) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return {
    manifest: ajv.compile(manifestSchema),
    paywall: ajv.compile(paywallSchema),
  };
}

function formatSchemaErrors(label, validationErrors = []) {
  return validationErrors.map((error) => {
    const location = error.instancePath || "/";
    return `${label}${location} ${error.message ?? "is invalid"}`;
  });
}

function addUniqueFieldValues(errors, entries, field, label) {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry[field];
    if (seen.has(value)) {
      errors.push(`${label} contains duplicate ${field} ${value}`);
    }
    seen.add(value);
  }
}

function addUniqueCapabilities(errors, entries, label) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      errors.push(`${label} declares capability ${entry.name} more than once`);
    }
    seen.add(entry.name);
  }
}

export function walkV03DocumentNodes(document) {
  const entries = [];

  function visit(node, screenId, ancestors = []) {
    if (!node || typeof node !== "object") return;
    entries.push({ node, screenId, ancestors });

    if (node.type === "scrollContainer") {
      visit(node.content, screenId, [...ancestors, node]);
    } else if (node.type === "stack") {
      for (const child of node.children ?? []) {
        visit(child, screenId, [...ancestors, node]);
      }
    } else if (node.type === "carousel") {
      for (const page of node.pages ?? []) {
        visit(page.content, screenId, [...ancestors, node]);
      }
    } else if (node.type === "tabs") {
      for (const entry of node.tabs ?? []) {
        visit(entry.content, screenId, [...ancestors, node]);
      }
    } else if (node.type === "button") {
      for (const child of node.children ?? []) {
        visit(child, screenId, [...ancestors, node]);
      }
      for (const child of node.inProgressChildren ?? []) {
        visit(child, screenId, [...ancestors, node]);
      }
    } else if (node.type === "productSelector") {
      for (const card of node.cards ?? []) {
        visit(card, screenId, [...ancestors, node]);
      }
    } else if (node.type === "productCard" || node.type === "productBadge") {
      for (const child of node.children ?? []) {
        visit(child, screenId, [...ancestors, node]);
      }
    }
  }

  for (const screen of document.screens ?? []) {
    visit(screen.layout, screen.id);
  }
  return entries;
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
        ([key, fieldValue]) =>
          colorFieldNames.has(key) && fieldValue !== undefined,
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

function documentUsesProductTemplates(document, entries) {
  for (const { node, ancestors } of entries) {
    if (
      node.type === "text" &&
      ancestors.some((ancestor) => ancestor.type === "productCard") &&
      localizedTextUsesProductTemplate(document, node.value)
    ) {
      return true;
    }
    if (
      node.type === "productCard" &&
      node.accessibility?.label &&
      localizedTextUsesProductTemplate(document, node.accessibility.label)
    ) {
      return true;
    }
  }
  return false;
}

export function expectedV03DocumentCapabilities(document) {
  const capabilities = new Set([
    "navigation.screens",
    "localization.catalogs",
  ]);
  const entries = walkV03DocumentNodes(document);
  const designSystem = document.designSystem ?? {
    colors: [],
    backgrounds: [],
    shadows: [],
  };

  if (documentUsesProductTemplates(document, entries)) {
    capabilities.add("localization.productTemplate");
  }
  if (
    Object.values(reservedAccessibilityKeys).some((reserved) =>
      reserved.consumedBy(entries),
    )
  ) {
    capabilities.add("accessibility.reservedStrings");
  }

  if (
    Object.values(document.localization?.locales ?? {}).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    capabilities.add("localization.rtl");
  }
  if ((document.products?.length ?? 0) > 0) {
    capabilities.add("product.references");
  }
  if (
    designSystem.colors.length > 0 ||
    designSystem.backgrounds.length > 0 ||
    designSystem.shadows.length > 0
  ) {
    capabilities.add("style.designTokens");
  }
  for (const asset of document.assets ?? []) {
    const sourceKind = asset.source?.type === "remote" ? "remote" : "bundled";
    if (asset.type === "image") {
      capabilities.add(`asset.${sourceKind}Image`);
      capabilities.add("fallback.asset");
    } else if (asset.type === "video") {
      capabilities.add(`asset.${sourceKind}Video`);
    }
  }

  const authoredValues = [designSystem, ...entries.map(({ node }) => node)];
  if (
    authoredValues.some((value) =>
      objectUsesType(value, new Set(["linearGradient", "radialGradient"])),
    )
  ) {
    capabilities.add("style.gradientBackground");
  }
  if (
    authoredValues.some((value) => objectUsesMediaBackground(value))
  ) {
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
  if ((document.screens ?? []).some((screen) => screen.presentation?.type === "sheet")) {
    capabilities.add("navigation.sheets");
  }

  for (const { node } of entries) {
    const capability = capabilityByType[node.type];
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

export function orderedV03Capabilities(document, paywallSchema) {
  const expected = expectedV03DocumentCapabilities(document);
  return paywallSchema.$defs.capabilityName.enum
    .filter((name) => expected.has(name))
    .map((name) => ({ name, version: "0.3" }));
}

function validateCapabilities(
  errors,
  document,
  manifest,
  paywallSchema,
  manifestSchema,
) {
  const documentNames = new Set(paywallSchema.$defs.capabilityName.enum);
  const manifestNames = new Set(manifestSchema.$defs.capabilityName.enum);
  for (const name of documentNames) {
    if (!manifestNames.has(name)) {
      errors.push(`manifest schema omits paywall capability ${name}`);
    }
  }
  for (const name of manifestNames) {
    if (!documentNames.has(name)) {
      errors.push(`manifest schema declares unknown capability ${name}`);
    }
  }

  addUniqueCapabilities(
    errors,
    document.compatibility.requiredCapabilities,
    "document",
  );
  addUniqueCapabilities(errors, manifest.capabilities, "manifest");

  const expected = expectedV03DocumentCapabilities(document);
  const declared = new Map(
    document.compatibility.requiredCapabilities.map((entry) => [
      entry.name,
      entry.version,
    ]),
  );
  const supported = new Map(
    manifest.capabilities.map((entry) => [entry.name, entry.version]),
  );

  for (const name of expected) {
    if (!declared.has(name)) {
      errors.push(`document is missing required capability ${name}`);
    }
  }
  for (const [name, version] of declared) {
    if (!expected.has(name)) {
      errors.push(`document declares unused capability ${name}`);
    } else if (!supported.has(name)) {
      errors.push(`manifest does not support required capability ${name}`);
    } else if (supported.get(name) !== version) {
      errors.push(
        `manifest supports ${name}@${supported.get(name)}, ` +
          `but the document requires ${name}@${version}`,
      );
    }
  }

  for (const name of documentNames) {
    if (!supported.has(name)) {
      errors.push(`manifest omits schema capability ${name}`);
    }
  }
}

function validateIdentifiers(errors, document, entries) {
  addUniqueFieldValues(errors, document.screens, "id", "screen catalog");
  const identifiable = entries.map(({ node }) => node);
  for (const { node } of entries) {
    if (node.type === "carousel") identifiable.push(...node.pages);
    // A tab id names a control, a panel, and the value a tab-visibility
    // condition compares against, so it shares the one layout namespace.
    if (node.type === "tabs") identifiable.push(...node.tabs);
  }
  addUniqueFieldValues(errors, identifiable, "id", "layout tree");
  for (const { node } of entries) {
    if (node.type === "featureList") {
      addUniqueFieldValues(errors, node.items, "id", `feature list ${node.id}`);
    }
    if (node.type === "timeline") {
      addUniqueFieldValues(errors, node.entries, "id", `timeline ${node.id}`);
    }
  }
}

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

function validateAssetReferences(errors, document, entries) {
  addUniqueFieldValues(errors, document.assets, "id", "asset catalog");
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const referenced = new Set();
  // Every place a component names an image asset, with the label used in the
  // diagnostic. Adding a component that references an asset without adding it
  // here would let its asset go uncounted and then be reported as unused, so
  // the list is exhaustive by construction rather than by convention.
  const imageAssetReferences = (node) => {
    if (node.type === "image") return [{ assetId: node.assetId, label: `image ${node.id}` }];
    if (node.type === "award" && node.emblem?.type === "image") {
      return [{ assetId: node.emblem.assetId, label: `award ${node.id} emblem` }];
    }
    if (node.type === "socialProof" && node.avatar) {
      return [{ assetId: node.avatar.assetId, label: `social proof ${node.id} avatar` }];
    }
    return [];
  };
  for (const { node } of entries) {
    for (const { assetId, label } of imageAssetReferences(node)) {
      const asset = assets.get(assetId);
      if (!asset) {
        errors.push(`${label} references unknown asset ${assetId}`);
      } else if (asset.type !== "image") {
        errors.push(`${label} must reference an image asset`);
      } else {
        referenced.add(assetId);
      }
    }
  }
  for (const asset of document.assets) {
    if (asset.source.type === "remote" && !safeAbsoluteHttps(asset.source.url)) {
      errors.push(
        `asset ${asset.id} remote source must use safe absolute HTTPS without credentials`,
      );
    }
  }
  const backgroundRoots = [
    document.designSystem,
    ...entries.map(({ node }) => node),
    ...document.screens.map((screen) => screen.layout),
  ];
  for (const root of backgroundRoots) {
    walkObjectValues(root, (value, path) => {
      if (
        (value.type !== "image" && value.type !== "video") ||
        !Object.hasOwn(value, "fallbackColor")
      ) {
        return;
      }
      const asset = assets.get(value.assetId);
      if (!asset) {
        errors.push(`background${path} references unknown asset ${value.assetId}`);
      } else if (asset.type !== value.type) {
        errors.push(
          `${value.type} background${path} must reference a ${value.type} asset`,
        );
      } else {
        referenced.add(value.assetId);
      }
      if (value.type === "video" && value.posterAssetId) {
        const poster = assets.get(value.posterAssetId);
        if (!poster) {
          errors.push(
            `video background${path} references unknown poster asset ${value.posterAssetId}`,
          );
        } else if (poster.type !== "image") {
          errors.push(`video background${path} poster must reference an image asset`);
        } else {
          referenced.add(value.posterAssetId);
        }
      }
    });
  }
  for (const asset of document.assets) {
    if (!referenced.has(asset.id)) {
      errors.push(`asset catalog declares unused asset ${asset.id}`);
    }
  }
}

function validateDesignSystem(errors, document, entries) {
  const catalogs = {
    colorToken: document.designSystem.colors,
    backgroundToken: document.designSystem.backgrounds,
    shadowToken: document.designSystem.shadows,
  };
  for (const [type, catalog] of Object.entries(catalogs)) {
    const label = type.replace("Token", " token catalog");
    addUniqueFieldValues(errors, catalog, "id", label);
    addUniqueFieldValues(errors, catalog, "name", label);
  }

  const known = Object.fromEntries(
    Object.entries(catalogs).map(([type, catalog]) => [
      type,
      new Set(catalog.map((token) => token.id)),
    ]),
  );
  const roots = [document.designSystem, ...entries.map(({ node }) => node)];
  for (const root of roots) {
    walkObjectValues(root, (value, path) => {
      if (!Object.hasOwn(catalogs, value.type)) return;
      if (!known[value.type].has(value.id)) {
        errors.push(`${value.type} reference${path} targets unknown token ${value.id}`);
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
    for (const id of graph.keys()) {
      if (hasCycle(id)) {
        errors.push(`${type} catalog contains a reference cycle`);
        break;
      }
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
          errors.push(`gradient${path} stops must be ordered with unique positions`);
          break;
        }
        prior = stop.position;
      }
    });
  }
}

function validateProductReferences(errors, document, entries) {
  addUniqueFieldValues(errors, document.products, "id", "product catalog");
  addUniqueFieldValues(errors, document.products, "productId", "product catalog");
  const products = new Map(document.products.map((product) => [product.id, product]));
  const referenced = new Set();
  const selectors = new Map();
  const purchaseTargets = new Set();

  for (const entry of entries) {
    const { node } = entry;
    if (node.type === "productSelector") {
      selectors.set(node.id, entry);
      const cardIds = new Set(node.cards.map((card) => card.id));
      const selectorProductIds = new Set();
      for (const card of node.cards) {
        const id = card.productReferenceId;
        if (!products.has(id)) {
          errors.push(`product selector ${node.id} references unknown product ${id}`);
        }
        if (selectorProductIds.has(id)) {
          errors.push(
            `product selector ${node.id} contains duplicate product reference ${id}`,
          );
        }
        selectorProductIds.add(id);
        referenced.add(id);
      }
      if (!cardIds.has(node.initialProductCardId)) {
        errors.push(
          `product selector ${node.id} initially selects an undeclared Product Card`,
        );
      }
    } else if (node.type === "button" && node.action.type === "purchase") {
      purchaseTargets.add(`${entry.screenId}:${node.action.productSelectorId}`);
    }
  }

  for (const { node, screenId } of entries) {
    if (node.type !== "button" || node.action.type !== "purchase") continue;
    const selector = selectors.get(node.action.productSelectorId);
    if (!selector) {
      errors.push(
        `button ${node.id} references unknown product selector ` +
          node.action.productSelectorId,
      );
    } else if (selector.screenId !== screenId) {
      errors.push(
        `purchase button ${node.id} must reference a Product Selector on ` +
          `screen ${screenId}`,
      );
    }
  }
  for (const { node: selector, screenId } of selectors.values()) {
    if (!purchaseTargets.has(`${screenId}:${selector.id}`)) {
      errors.push(`product selector ${selector.id} has no purchase action`);
    }
  }
  for (const product of document.products) {
    if (!referenced.has(product.id)) {
      errors.push(`product catalog declares unused product ${product.id}`);
    }
  }
}

function collectLocalizedText(value, path, entries, templateAllowed = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectLocalizedText(entry, `${path}/${index}`, entries, templateAllowed),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  if (
    typeof value.default === "string" &&
    typeof value.localizationKey === "string"
  ) {
    entries.push({ path, text: value, templateAllowed: templateAllowed.has(value) });
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    collectLocalizedText(entry, `${path}/${key}`, entries, templateAllowed);
  }
}

function validateLocalization(errors, document, nodeEntries) {
  const { defaultLocale, fallbackLocale, locales } = document.localization;
  if (!Object.hasOwn(locales, defaultLocale)) {
    errors.push(`localization default locale ${defaultLocale} is not declared`);
  }
  if (!Object.hasOwn(locales, fallbackLocale)) {
    errors.push(`localization fallback locale ${fallbackLocale} is not declared`);
  }
  if (!Object.hasOwn(locales, defaultLocale)) return;

  const templateAllowed = new Set();
  for (const { node, ancestors } of walkV03DocumentNodes(document)) {
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
  const entries = [];
  collectLocalizedText(document.assets, "/assets", entries, templateAllowed);
  collectLocalizedText(document.products, "/products", entries, templateAllowed);
  collectLocalizedText(document.screens, "/screens", entries, templateAllowed);
  const referenced = new Set();
  const defaultStrings = locales[defaultLocale].strings;

  for (const { path, text, templateAllowed: mayUseProductTemplate } of entries) {
    referenced.add(text.localizationKey);
    if (!Object.hasOwn(defaultStrings, text.localizationKey)) {
      errors.push(
        `${path} references missing default localization key ` +
          text.localizationKey,
      );
    } else if (defaultStrings[text.localizationKey] !== text.default) {
      errors.push(
        `${path} default text does not match ${defaultLocale} catalog key ` +
          text.localizationKey,
      );
    }
    for (const value of localizedTextValues(document, text)) {
      const analysis = analyzeProductTemplate(value);
      if (analysis.malformed) {
        errors.push(`${path} contains a malformed product template expression`);
      }
      if (analysis.variables.length > 0 && !mayUseProductTemplate) {
        errors.push(
          `${path} uses a product template outside a Product Card or Product Badge subtree`,
        );
      }
    }
  }
  for (const [key, reserved] of Object.entries(reservedAccessibilityKeys)) {
    const consumed = reserved.consumedBy(nodeEntries);
    const declared = Object.hasOwn(defaultStrings, key);
    if (consumed && !declared) {
      errors.push(
        `default localization catalog must declare reserved key ${key} because ` +
          `the document contains ${reserved.consumer}`,
      );
    } else if (!consumed && declared) {
      errors.push(
        `default localization catalog declares reserved key ${key} but the ` +
          "document contains nothing that announces it",
      );
    }
    if (!declared) continue;
    for (const [locale, catalog] of Object.entries(locales)) {
      const value = catalog.strings[key];
      if (value === undefined) continue;
      for (const placeholder of reserved.placeholders) {
        const occurrences = value.split(placeholder).length - 1;
        if (occurrences !== 1) {
          errors.push(
            `localization catalog ${locale} key ${key} must contain ` +
              `${placeholder} exactly once`,
          );
        }
      }
      const residue = reserved.placeholders.reduce(
        (text, placeholder) => text.replaceAll(placeholder, ""),
        value,
      );
      if (residue.includes("{{") || residue.includes("}}")) {
        errors.push(
          `localization catalog ${locale} key ${key} contains an unsupported ` +
            "template expression",
        );
      }
    }
  }
  for (const key of Object.keys(defaultStrings)) {
    // Reserved keys are consumed by the protocol, not referenced by a
    // component, so the unused sweep would flag every one of them.
    if (Object.hasOwn(reservedAccessibilityKeys, key)) continue;
    if (!referenced.has(key)) {
      errors.push(`default localization catalog declares unused key ${key}`);
    }
  }
  for (const [locale, catalog] of Object.entries(locales)) {
    if (locale === defaultLocale) continue;
    for (const key of Object.keys(catalog.strings)) {
      if (!Object.hasOwn(defaultStrings, key)) {
        errors.push(`localization catalog ${locale} declares unknown key ${key}`);
      }
    }
  }
}

function validateLayoutAndRuntime(errors, document, entries) {
  const screens = new Map(document.screens.map((screen) => [screen.id, screen]));
  if (!screens.has(document.initialScreenId)) {
    errors.push(`initialScreenId references unknown screen ${document.initialScreenId}`);
  } else if (screens.get(document.initialScreenId).presentation.type !== "screen") {
    errors.push("initial screen presentation must be screen");
  }
  for (const screen of document.screens) {
    if (screen.layout.content.direction !== "vertical") {
      errors.push(`screen ${screen.id} root scroll content must be a vertical stack`);
    }
    if (screen.layout.content.children.length === 0) {
      errors.push(`screen ${screen.id} root scroll content must contain at least one child`);
    }
  }

  const switches = new Map(
    entries
      .filter(({ node }) => node.type === "switch")
      .map((entry) => [entry.node.id, entry]),
  );
  const tabsById = new Map(
    entries
      .filter(({ node }) => node.type === "tabs")
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
    "tabs",
  ]);

  for (const { node, screenId, ancestors } of entries) {
    if (node.type === "productCard") {
      const directParent = ancestors.at(-1);
      if (directParent?.type !== "productSelector") {
        errors.push(`Product Card ${node.id} must be directly owned by a Product Selector`);
      }
      const directBadges = node.children.filter(
        (child) => child.type === "productBadge",
      );
      if (directBadges.length > 1) {
        errors.push(`Product Card ${node.id} may contain at most one direct Product Badge`);
      }
      let passiveDescendants = 0;
      let maximumStackDepth = 0;
      const visitPassive = (child, stackDepth = 0) => {
        passiveDescendants += 1;
        const nextStackDepth = child.type === "stack" ? stackDepth + 1 : stackDepth;
        maximumStackDepth = Math.max(maximumStackDepth, nextStackDepth);
        for (const descendant of child.children ?? []) {
          visitPassive(descendant, nextStackDepth);
        }
      };
      for (const child of node.children) visitPassive(child);
      if (passiveDescendants > 20) {
        errors.push(`Product Card ${node.id} exceeds 20 passive descendants`);
      }
      if (maximumStackDepth > 4) {
        errors.push(`Product Card ${node.id} exceeds nested Stack depth 4`);
      }
    }
    if (node.type === "productBadge") {
      const directParent = ancestors.at(-1);
      if (directParent?.type !== "productCard") {
        errors.push(`Product Badge ${node.id} must be a direct Product Card child`);
      }
    }
    if (
      ancestors.some((entry) => entry.type === "button") &&
      interactiveButtonDescendants.has(node.type)
    ) {
      errors.push(
        `button content cannot contain interactive ${node.type} ${node.id}`,
      );
    }
    if (
      node.type === "button" &&
      node.inProgressChildren &&
      !["purchase", "restore"].includes(node.action.type)
    ) {
      errors.push(
        `button ${node.id} may use inProgressChildren only for purchase or restore`,
      );
    }
    if (
      node.type === "carousel" &&
      ancestors.some((entry) => entry.type === "carousel")
    ) {
      errors.push(`carousel ${node.id} cannot be nested inside another carousel`);
    }
    if (node.type === "carousel" && node.initialPageIndex >= node.pages.length) {
      errors.push(
        `carousel ${node.id} initialPageIndex must reference an existing page`,
      );
    }
    if (node.type === "tabs") {
      addUniqueFieldValues(errors, node.tabs, "id", `tabs ${node.id}`);
      if (!node.tabs.some((tab) => tab.id === node.initialTabId)) {
        errors.push(
          `tabs ${node.id} initialTabId must name one of its declared tabs`,
        );
      }
    }
    if (node.type === "timeline") {
      const markedEntries = node.entries.filter((entry) => entry.marker);
      const describedEntries = node.entries.filter((entry) => entry.description);
      // Both directions matter. Missing style where a marker exists leaves the
      // renderer choosing a colour; declared style where no marker exists is a
      // value nothing consumes, which is how a stale field survives a redesign.
      for (const [field, used] of [
        ["markerColor", markedEntries.length > 0],
        ["markerSize", markedEntries.length > 0],
        ["descriptionTypography", describedEntries.length > 0],
      ]) {
        const declared = Object.hasOwn(node, field);
        if (used && !declared) {
          errors.push(`timeline ${node.id} must declare ${field}`);
        } else if (!used && declared) {
          errors.push(
            `timeline ${node.id} declares ${field} but no entry uses it`,
          );
        }
      }
    }
    if (node.type === "socialProof" && node.rating) {
      const stepsPerPoint = node.rating.step === "half" ? 2 : 1;
      const maximumSteps = node.rating.maximum * stepsPerPoint;
      if (node.rating.value > maximumSteps) {
        errors.push(
          `social proof ${node.id} rating value ${node.rating.value} exceeds ` +
            `${maximumSteps} ${node.rating.step} steps out of ${node.rating.maximum}`,
        );
      }
    }
    if (node.visibility?.mode === "tab") {
      const controller = tabsById.get(node.visibility.tabsId);
      if (!controller) {
        errors.push(
          `${node.type} ${node.id} visibility references unknown tabs ` +
            node.visibility.tabsId,
        );
      } else if (controller.screenId !== screenId) {
        errors.push(
          `${node.type} ${node.id} visibility must reference a Tabs component on ` +
            `screen ${screenId}`,
        );
      } else if (
        controller.node.id === node.id ||
        ancestors.some((ancestor) => ancestor === controller.node)
      ) {
        // Inside a panel the condition is already decided: comparing against
        // the owning tab is vacuously true and against any other tab is
        // unsatisfiable. Both are dead layout, so both reject.
        errors.push(
          `${node.type} ${node.id} visibility cannot reference the Tabs component it belongs to`,
        );
      } else if (
        !controller.node.tabs.some((tab) => tab.id === node.visibility.equals)
      ) {
        errors.push(
          `${node.type} ${node.id} visibility references unknown tab ` +
            `${node.visibility.equals} of tabs ${controller.node.id}`,
        );
      }
    }
    if (node.visibility?.mode === "switch") {
      const controller = switches.get(node.visibility.switchId);
      if (!controller) {
        errors.push(
          `${node.type} ${node.id} visibility references unknown switch ` +
            node.visibility.switchId,
        );
      } else if (controller.node.id === node.id) {
        errors.push(
          `${node.type} ${node.id} visibility cannot reference itself`,
        );
      } else if (controller.screenId !== screenId) {
        errors.push(
          `${node.type} ${node.id} visibility must reference a Switch on ` +
            `screen ${screenId}`,
        );
      }
    }
    if (node.type === "button" && node.action.type === "navigateTo") {
      const targetScreenId = node.action.screenId;
      if (!screens.has(targetScreenId)) {
        errors.push(
          `button ${node.id} navigateTo references unknown screen ${targetScreenId}`,
        );
      } else if (targetScreenId === screenId) {
        errors.push(
          `button ${node.id} navigateTo target must differ from source screen ${screenId}`,
        );
      } else {
        navigationEdges.get(screenId)?.add(targetScreenId);
      }
    }
    if (node.type === "button" && node.action.type === "openExternalUrl") {
      const value = node.action.url;
      if (!safeAbsoluteHttps(value)) {
        errors.push(
          `button ${node.id} openExternalUrl must use safe absolute HTTPS without credentials`,
        );
      }
    }
    if (node.type === "countdown") {
      const timestamp = Date.parse(node.endsAt);
      if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().replace(".000Z", "Z") !== node.endsAt
      ) {
        errors.push(`countdown ${node.id} endsAt is not a canonical UTC instant`);
      }
      if (
        countdownUnitOrder[node.largestUnit] >
        countdownUnitOrder[node.smallestUnit]
      ) {
        errors.push(
          `countdown ${node.id} largestUnit must not be smaller than smallestUnit`,
        );
      }
    }
  }

  if (screens.has(document.initialScreenId)) {
    const reachable = new Set();
    const pending = [document.initialScreenId];
    while (pending.length > 0) {
      const screenId = pending.pop();
      if (reachable.has(screenId)) continue;
      reachable.add(screenId);
      pending.push(...(navigationEdges.get(screenId) ?? []));
    }
    for (const screen of document.screens) {
      if (!reachable.has(screen.id)) {
        errors.push(
          `screen ${screen.id} is unreachable from initial screen ${document.initialScreenId}`,
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
  for (const screen of document.screens) {
    if (graphHasCycle(screen.id)) {
      errors.push("navigateTo graph must be acyclic");
      break;
    }
  }
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
  const base = productCard.styles.default;
  if (!selected) return structuredClone(base);
  return recursiveOverlay(base, productCard.styles.selected);
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

export function resolveV03ColorToken(document, color) {
  return resolveTokenValue(document, "colors", "colorToken", color);
}

export function resolveV03BackgroundToken(document, background) {
  return resolveTokenValue(
    document,
    "backgrounds",
    "backgroundToken",
    background,
  );
}

export function resolveV03ShadowToken(document, shadow) {
  return resolveTokenValue(document, "shadows", "shadowToken", shadow);
}

export function resolveV03AxisSizing(
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

export function resolveV03MediaBackgroundFallback(
  document,
  background,
  availableAssetIds,
) {
  const resolved = resolveV03BackgroundToken(document, background);
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
    background: {
      type: "color",
      value: structuredClone(resolved.fallbackColor),
    },
    diagnostic: {
      code: `background.${resolved.type}Unavailable`,
      assetId: resolved.assetId,
      behavior: "useFallbackColor",
      message: `${resolved.type === "video" ? "Video" : "Image"} background is unavailable; the declared fallback colour is used.`,
    },
  };
}

export function interpolateProductText(value, product) {
  if (typeof value !== "string") {
    return {
      available: false,
      value: null,
      diagnostic: "invalidTemplate",
    };
  }
  const analysis = analyzeProductTemplate(value);
  if (analysis.malformed) {
    return {
      available: false,
      value: null,
      diagnostic: "invalidTemplate",
    };
  }
  if (
    analysis.variables.includes("price") &&
    (typeof product?.price !== "string" || product.price.trim().length === 0)
  ) {
    return {
      available: false,
      value: null,
      diagnostic: "missingPrice",
    };
  }
  const resolvedName =
    typeof product?.name === "string" && product.name.trim().length > 0
      ? product.name
      : product?.fallbackName;
  if (
    analysis.variables.includes("name") &&
    (typeof resolvedName !== "string" || resolvedName.trim().length === 0)
  ) {
    return {
      available: false,
      value: null,
      diagnostic: "missingName",
    };
  }
  const resolved = value.replace(productTemplatePattern, (_match, variable) =>
    variable === "name" ? resolvedName : product.price,
  );
  return { available: true, value: resolved, diagnostic: null };
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

function initialSwitchValues(entries) {
  return Object.fromEntries(
    entries
      .filter(({ node }) => node.type === "switch")
      .map(({ node }) => [node.id, node.initialValue]),
  );
}

function initialTabSelections(entries) {
  return Object.fromEntries(
    entries
      .filter(({ node }) => node.type === "tabs")
      .map(({ node }) => [node.id, node.initialTabId]),
  );
}

/**
 * Selection state a conditional-visibility decision depends on.
 *
 * `selectionState` carries `{ switches, tabs }`. A condition whose controller
 * is absent from the state it was handed throws rather than resolving: an
 * unknown Switch compared with `===` reads back as `false`, and `false` is a
 * component that silently disappears. A caller that has not gathered the state
 * has a bug, and the bug should surface where it is, not as missing UI.
 */
export function evaluateV03Visibility(visibility, selectionState = {}) {
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

function entryIsVisible(entry, selectionState) {
  return [...entry.ancestors, entry.node].every((node) =>
    evaluateV03Visibility(node.visibility, selectionState),
  );
}

export function runtimeStateForAcceptedV03Revision(document) {
  const entries = walkV03DocumentNodes(document);
  return {
    switches: initialSwitchValues(entries),
    tabs: initialTabSelections(entries),
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

export function resolveV03CountdownState(countdown, now) {
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

export function protocolV03RuntimeDiagnostics(
  document,
  selectionState,
  navigationState,
) {
  const entries = walkV03DocumentNodes(document);
  const effectiveSelection = selectionState ?? {
    switches: initialSwitchValues(entries),
    tabs: initialTabSelections(entries),
  };
  const effectiveNavigation = navigationState ?? {
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
      screenId === effectiveNavigation.currentScreenId &&
      effectiveNavigation.history.length <= 1
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
    const selectorEntry = selectors.get(node.action.productSelectorId);
    if (selectorEntry && !entryIsVisible(selectorEntry, effectiveSelection)) {
      diagnostics.push({
        code: "purchase.hiddenProductSelector",
        componentId: node.id,
        productSelectorId: selectorEntry.node.id,
        behavior: "disablePurchase",
        message: "Purchase is disabled because its Product Selector is hidden.",
      });
    }
  }
  return diagnostics;
}

export function applyV03NavigationAction(navigationState, action) {
  const history = [...navigationState.history];
  if (action.type === "navigateTo") {
    history.push(action.screenId);
    return {
      state: { currentScreenId: action.screenId, history },
      diagnostic: null,
    };
  }
  if (action.type !== "navigateBack") {
    return { state: structuredClone(navigationState), diagnostic: null };
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

function opaqueLiteralLuminance(color) {
  const match = /^#([0-9A-F]{6})FF$/.exec(color);
  if (!match) return null;
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Why a literal colour pair could not be contrast-checked, or null if it could.
 *
 * Semantic tokens are a legitimate skip: their value is a renderer's theme, not
 * the document's. A literal is not. An opaque literal that fails to parse means
 * the checker was handed something it did not understand and silently passed the
 * pair, so say so instead. Schema validation should already have rejected such a
 * value; this is the cheap defence for when it has not run or has drifted.
 */
function unparsableLiteralColor(color) {
  if (typeof color !== "string" || !color.startsWith("#")) return null;
  if (opaqueLiteralLuminance(color) !== null) return null;
  // A valid but translucent literal is unevaluable rather than malformed: the
  // composited result depends on what is behind it.
  if (/^#[0-9A-F]{6}(?!FF$)[0-9A-F]{2}$/.test(color)) return null;
  return color;
}

function hasKnownLowContrast(foreground, background) {
  if (foreground === background) return true;
  const foregroundLuminance = opaqueLiteralLuminance(foreground);
  const backgroundLuminance = opaqueLiteralLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) {
    return false;
  }
  const ratio =
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  return ratio < 4.5;
}

export function protocolV03AuthoringWarnings(document) {
  const warnings = [];
  for (const { node } of walkV03DocumentNodes(document)) {
    if (node.type !== "productCard" && node.type !== "productBadge") continue;
    const defaultStyle = resolveProductCardStyle(node, false);
    const selectedStyle = resolveProductCardStyle(node, true);
    if (JSON.stringify(defaultStyle) === JSON.stringify(selectedStyle)) {
      warnings.push({
        code: "productCard.indistinguishableStates",
        componentId: node.id,
        message:
          "Product Card Default and Selected appearance are visually indistinguishable.",
      });
    }
    for (const [state, style] of [
      ["default", defaultStyle],
      ["selected", selectedStyle],
    ]) {
      for (const descendant of node.children ?? []) {
        const foreground = descendant.typography?.color
          ? resolveV03ColorToken(document, descendant.typography.color)
          : null;
        const field = descendant.id;
        const resolvedBackground = style.background
          ? resolveV03BackgroundToken(document, style.background)
          : null;
        const background =
          resolvedBackground?.type === "color"
            ? resolveV03ColorToken(document, resolvedBackground.value)
            : null;
        if (!foreground) continue;
        if (!background) continue;
        const unparsable =
          unparsableLiteralColor(foreground) ?? unparsableLiteralColor(background);
        if (unparsable !== null) {
          warnings.push({
            code: "productCard.contrastNotEvaluated",
            componentId: node.id,
            state,
            field,
            message: `${node.type} ${state} child ${field} could not be contrast-checked: ${unparsable} is not a readable colour literal.`,
          });
          continue;
        }
        if (hasKnownLowContrast(foreground, background)) {
          warnings.push({
            code: "productCard.lowContrast",
            componentId: node.id,
            state,
            field,
            message: `${node.type} ${state} child ${field} has known low contrast.`,
          });
        }
      }
    }
  }
  return warnings;
}

export function validateProtocolV03({
  document,
  manifest,
  manifestSchema,
  paywallSchema,
}) {
  const validators = createSchemaValidators({ manifestSchema, paywallSchema });
  const errors = [];
  const documentIsValid = validators.paywall(document);
  const manifestIsValid = validators.manifest(manifest);
  if (!documentIsValid) {
    errors.push(...formatSchemaErrors("document", validators.paywall.errors));
  }
  if (!manifestIsValid) {
    errors.push(...formatSchemaErrors("manifest", validators.manifest.errors));
  }
  if (!documentIsValid || !manifestIsValid) return errors;

  if (document.schemaVersion !== manifest.schemaVersion) {
    errors.push(
      `document schema version ${document.schemaVersion} does not match ` +
        `manifest version ${manifest.schemaVersion}`,
    );
  }
  const entries = walkV03DocumentNodes(document);
  validateCapabilities(
    errors,
    document,
    manifest,
    paywallSchema,
    manifestSchema,
  );
  validateIdentifiers(errors, document, entries);
  validateDesignSystem(errors, document, entries);
  validateAssetReferences(errors, document, entries);
  validateProductReferences(errors, document, entries);
  validateLocalization(errors, document, entries);
  validateLayoutAndRuntime(errors, document, entries);
  return errors;
}

export function validateCanonicalV03Coverage(document) {
  const errors = [];
  const entries = walkV03DocumentNodes(document);
  const types = new Set(entries.map(({ node }) => node.type));
  for (const type of requiredCanonicalComponentTypes) {
    if (!types.has(type)) errors.push(`canonical fixture omits component ${type}`);
  }
  if (document.screens.length !== 2) {
    errors.push("canonical fixture must demonstrate exactly two screens");
  }
  if (
    document.screens[0]?.presentation?.type !== "screen" ||
    !document.screens.some((screen) => screen.presentation?.type === "sheet")
  ) {
    errors.push("canonical fixture must demonstrate Screen and Sheet presentation");
  }
  if (
    (document.designSystem?.colors.length ?? 0) === 0 ||
    (document.designSystem?.backgrounds.length ?? 0) === 0 ||
    (document.designSystem?.shadows.length ?? 0) === 0
  ) {
    errors.push("canonical fixture must demonstrate every design token category");
  }
  const backgroundTypes = new Set(
    (document.designSystem?.backgrounds ?? []).map(({ value }) => value.type),
  );
  for (const type of ["linearGradient", "radialGradient", "image", "video"]) {
    if (!backgroundTypes.has(type)) {
      errors.push(`canonical fixture omits ${type} background`);
    }
  }
  const assets = new Set(
    (document.assets ?? []).map(
      (asset) => `${asset.type}:${asset.source.type}`,
    ),
  );
  for (const key of ["image:bundled", "image:remote", "video:bundled", "video:remote"]) {
    if (!assets.has(key)) errors.push(`canonical fixture omits ${key} asset`);
  }
  if (!entries.some(({ node }) => node.appearance?.shadow || node.styles?.default?.shadow)) {
    errors.push("canonical fixture omits an authored box shadow");
  }
  if (
    !entries.some(
      ({ node }) =>
        node.sizing?.width !== undefined && node.sizing?.height !== undefined,
    )
  ) {
    errors.push("canonical fixture omits uniform two-axis sizing");
  }
  const actionTypes = new Set(
    entries
      .filter(({ node }) => node.type === "button")
      .map(({ node }) => node.action.type),
  );
  for (const action of [
    "purchase",
    "restore",
    "close",
    "navigateTo",
    "navigateBack",
    "openExternalUrl",
  ]) {
    if (!actionTypes.has(action)) {
      errors.push(`canonical fixture omits button action ${action}`);
    }
  }
  const hasTextAndIconButton = entries.some(
    ({ node }) =>
      node.type === "button" &&
      node.children.some((child) => child.type === "text") &&
      node.children.some((child) => child.type === "icon"),
  );
  if (!hasTextAndIconButton) {
    errors.push("canonical fixture omits a Button with Text and Icon children");
  }
  const productCards = entries.filter(({ node }) => node.type === "productCard");
  if (productCards.length < 3) {
    errors.push("canonical fixture must demonstrate at least three Product Cards");
  }
  if (!entries.some(({ node }) => node.type === "productBadge" && node.placement.mode === "nested")) {
    errors.push("canonical fixture omits a nested Product Badge");
  }
  if (
    !entries.some(
      ({ node }) =>
        node.type === "productBadge" &&
        node.placement.mode === "overlay" &&
        node.placement.anchor.includes("End"),
    )
  ) {
    errors.push("canonical fixture omits an RTL-relevant overlay Product Badge");
  }
  if (
    !entries.some(
      ({ node }) => node.type === "stack" && node.direction === "horizontal",
    )
  ) {
    errors.push("canonical fixture omits a horizontal stack");
  }
  const visibilityValues = new Set(
    entries
      .filter(({ node }) => node.visibility?.mode === "switch")
      .map(({ node }) => node.visibility.equals),
  );
  if (!visibilityValues.has(true) || !visibilityValues.has(false)) {
    errors.push("canonical fixture must exercise Switch visibility for both values");
  }
  if (!entries.some(({ node }) => node.visibility?.mode === "hidden")) {
    errors.push("canonical fixture omits statically hidden visibility");
  }
  if (
    !Object.values(document.localization?.locales ?? {}).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    errors.push("canonical fixture does not exercise RTL localization");
  }
  const defaultLocale = document.localization?.defaultLocale;
  const hasLongTranslation = Object.entries(
    document.localization?.locales ?? {},
  ).some(
    ([locale, catalog]) =>
      locale !== defaultLocale &&
      Object.values(catalog.strings).some((value) => value.length >= 120),
  );
  if (!hasLongTranslation) {
    errors.push("canonical fixture does not exercise a long localization");
  }
  const textWithTruncation = entries.find(
    ({ node }) => node.type === "text" && node.typography.maxLines,
  )?.node;
  if (!textWithTruncation?.accessibility?.label) {
    errors.push(
      "canonical fixture must pair Text maximum lines with a full accessibility label",
    );
  }
  errors.push(...canonicalV03NewComponentCoverage(entries));
  return errors;
}

/**
 * Coverage floors for the components 0.3 introduces.
 *
 * A component type appearing once proves only that it parses. Each floor below
 * names a distinguishable case -- an optional field present and absent, a
 * closed union's every arm, a conditional runtime state actually condition-ed
 * on -- because those are the cases a renderer gets wrong, and a corpus that
 * does not contain them cannot catch it.
 */
function canonicalV03NewComponentCoverage(entries) {
  const errors = [];
  const nodesOfType = (type) =>
    entries.filter(({ node }) => node.type === type).map(({ node }) => node);

  const tabs = nodesOfType("tabs");
  if (tabs.length === 0) {
    errors.push("canonical fixture omits a Tabs component");
  } else {
    if (!tabs.some((node) => node.tabs.length >= 3)) {
      errors.push("canonical fixture must demonstrate Tabs with at least three panels");
    }
    if (!tabs.some((node) => node.initialTabId !== node.tabs[0].id)) {
      errors.push(
        "canonical fixture must demonstrate a Tabs initial selection other than the first tab",
      );
    }
  }
  const tabConditioned = entries.filter(
    ({ node }) => node.visibility?.mode === "tab",
  );
  if (tabConditioned.length === 0) {
    errors.push("canonical fixture omits tab-conditional visibility");
  }

  const timelines = nodesOfType("timeline");
  if (timelines.length === 0) {
    errors.push("canonical fixture omits a Timeline component");
  } else {
    const markerKinds = new Set(
      timelines.flatMap((node) =>
        node.entries.filter((entry) => entry.marker).map((entry) => entry.marker.kind),
      ),
    );
    for (const kind of ["dot", "ordinal", "icon"]) {
      if (!markerKinds.has(kind)) {
        errors.push(`canonical fixture omits a Timeline ${kind} marker`);
      }
    }
    if (
      !timelines.some((node) => node.entries.some((entry) => entry.description)) ||
      !timelines.some((node) => node.entries.some((entry) => !entry.description))
    ) {
      errors.push(
        "canonical fixture must demonstrate Timeline entries with and without a description",
      );
    }
    const connectorStyles = new Set(timelines.map((node) => node.connector.style));
    if (connectorStyles.size < 2) {
      errors.push(
        "canonical fixture must demonstrate both Timeline connector styles",
      );
    }
  }

  const awards = nodesOfType("award");
  if (awards.length === 0) {
    errors.push("canonical fixture omits an Award component");
  } else {
    const emblemTypes = new Set(
      awards.filter((node) => node.emblem).map((node) => node.emblem.type),
    );
    for (const type of ["image", "icon"]) {
      if (!emblemTypes.has(type)) {
        errors.push(`canonical fixture omits an Award ${type} emblem`);
      }
    }
    if (!awards.some((node) => node.subtitle)) {
      errors.push("canonical fixture omits an Award subtitle");
    }
  }

  const socialProofs = nodesOfType("socialProof");
  if (socialProofs.length === 0) {
    errors.push("canonical fixture omits a Social Proof component");
  } else {
    const steps = new Set(
      socialProofs.filter((node) => node.rating).map((node) => node.rating.step),
    );
    for (const step of ["whole", "half"]) {
      if (!steps.has(step)) {
        errors.push(`canonical fixture omits a Social Proof ${step}-step rating`);
      }
    }
    if (!socialProofs.some((node) => !node.rating)) {
      errors.push("canonical fixture omits an unrated Social Proof");
    }
    if (!socialProofs.some((node) => node.avatar)) {
      errors.push("canonical fixture omits a Social Proof avatar");
    }
  }
  return errors;
}

/**
 * Every renderer must produce these announcement strings byte for byte.
 *
 * The floor is the point of the check. A vector file that was truncated,
 * emptied, or renamed out from under this loop would otherwise report perfect
 * conformance over zero cases -- the exact defect the 2026-08-05 corpus audit
 * found in the decision and locale-resolution loops.
 */
export const RATING_ANNOUNCEMENT_CASE_FLOOR = 10;

export function validateRatingAnnouncementVectors(
  vectors = readV03Json(protocolV03Paths.ratingAnnouncementVectors),
) {
  const errors = [];
  const cases = Array.isArray(vectors.cases) ? vectors.cases : [];
  if (cases.length < RATING_ANNOUNCEMENT_CASE_FLOOR) {
    errors.push(
      `rating-announcement vectors hold ${cases.length} cases but the contract ` +
        `declares a floor of ${RATING_ANNOUNCEMENT_CASE_FLOOR}`,
    );
  }
  const seen = new Set();
  const steps = new Set();
  const locales = new Set();
  for (const entry of cases) {
    if (seen.has(entry.id)) {
      errors.push(`rating-announcement vectors repeat case ${entry.id}`);
    }
    seen.add(entry.id);
    steps.add(entry.rating.step);
    locales.add(entry.locale);
    const maximumSteps =
      entry.rating.maximum * (entry.rating.step === "half" ? 2 : 1);
    if (entry.rating.value > maximumSteps) {
      errors.push(`rating-announcement case ${entry.id} exceeds its own scale`);
    }
    if (v03RatingPoints(entry.rating) !== entry.points) {
      errors.push(
        `rating-announcement case ${entry.id} records points ${entry.points} ` +
          `but the conversion yields ${v03RatingPoints(entry.rating)}`,
      );
    }
    if (v03RatingMaximumPoints(entry.rating) !== entry.maximumPoints) {
      errors.push(
        `rating-announcement case ${entry.id} records a wrong maximum`,
      );
    }
    let announcement;
    try {
      announcement = resolveV03RatingAnnouncement(entry.rating, entry.template);
    } catch (error) {
      errors.push(`rating-announcement case ${entry.id}: ${error.message}`);
      continue;
    }
    if (announcement !== entry.expectedAnnouncement) {
      errors.push(
        `rating-announcement case ${entry.id} expects ` +
          `"${entry.expectedAnnouncement}" but resolves to "${announcement}"`,
      );
    }
    // Announcing steps rather than points is the defect these vectors exist to
    // stop, so at least one case must make the two visibly disagree.
    if (entry.points === String(entry.rating.value) && entry.rating.step === "half" && entry.rating.value > 0) {
      errors.push(
        `rating-announcement case ${entry.id} cannot distinguish steps from points`,
      );
    }
  }
  for (const step of ["whole", "half"]) {
    if (!steps.has(step)) {
      errors.push(`rating-announcement vectors omit a ${step}-step case`);
    }
  }
  if (locales.size < 2) {
    errors.push(
      "rating-announcement vectors must exercise more than one authored phrasing",
    );
  }
  if (
    !cases.some(
      (entry) =>
        v03RatingPoints(entry.rating) !== String(entry.rating.value),
    )
  ) {
    errors.push(
      "rating-announcement vectors never exercise a steps-to-points conversion",
    );
  }
  return errors;
}

/**
 * The strings a requested locale resolves to, per the documented candidate
 * chain: the requested tag, its base language, `fallbackLocale`, then
 * `defaultLocale`. A key missing from the first declared catalog falls through
 * the remaining candidates -- catalogs are partial by design, so this is a
 * declared lookup order and not a fallback that hides missing data.
 */
export function v03ResolvedCatalogStrings(localization, requestedLocale) {
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
export function v03AccessibilityAnnouncement(node, { strings, state = null } = {}) {
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
        text: resolveV03RatingAnnouncement(
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

export const ACCESSIBILITY_ANNOUNCEMENT_CASE_FLOOR = 11;

/**
 * Reconciles the announcement vectors against the reference implementation.
 *
 * The floor and the coverage assertions below are the point: a vector file that
 * was truncated or emptied would otherwise report perfect conformance over zero
 * cases, and a corpus that only ever contained the easy shapes would report
 * conformance without exercising the rulings it exists to pin.
 */
export function validateAccessibilityAnnouncementVectors(
  vectors = readV03Json(protocolV03Paths.accessibilityAnnouncementVectors),
  document = readV03Json(protocolV03Paths.canonicalFixture),
) {
  const errors = [];
  const cases = Array.isArray(vectors.cases) ? vectors.cases : [];
  if (cases.length < ACCESSIBILITY_ANNOUNCEMENT_CASE_FLOOR) {
    errors.push(
      `accessibility-announcement vectors hold ${cases.length} cases but the ` +
        `contract declares a floor of ${ACCESSIBILITY_ANNOUNCEMENT_CASE_FLOOR}`,
    );
  }
  if (vectors.separator !== null) {
    errors.push("accessibility-announcement vectors must pin separator null");
  }
  const byId = new Map(
    walkV03DocumentNodes(document).map(({ node }) => [node.id, node]),
  );
  const seen = new Set();
  const types = new Set();
  const states = new Set();
  for (const entry of cases) {
    if (seen.has(entry.id)) {
      errors.push(`accessibility-announcement vectors repeat case ${entry.id}`);
    }
    seen.add(entry.id);
    types.add(entry.componentType);
    if (entry.state) states.add(entry.state);
    const node = byId.get(entry.componentId);
    if (!node) {
      errors.push(
        `accessibility-announcement case ${entry.id} names unknown component ` +
          entry.componentId,
      );
      continue;
    }
    if (entry.separator !== null) {
      errors.push(
        `accessibility-announcement case ${entry.id} declares a separator; ` +
          "segments are never joined",
      );
    }
    let expected;
    try {
      expected = v03AccessibilityAnnouncement(node, {
        strings: v03ResolvedCatalogStrings(document.localization, entry.locale),
        state: entry.state ?? null,
      });
    } catch (error) {
      errors.push(`accessibility-announcement case ${entry.id}: ${error.message}`);
      continue;
    }
    const recorded = {
      composition: entry.composition,
      separator: entry.separator,
      container: entry.container,
      elements: entry.elements,
      decorative: entry.decorative,
    };
    if (JSON.stringify(recorded) !== JSON.stringify(expected)) {
      errors.push(
        `accessibility-announcement case ${entry.id} does not match the ` +
          "reference implementation",
      );
    }
  }
  for (const type of ["socialProof", "award", "timeline", "button"]) {
    if (!types.has(type)) {
      errors.push(`accessibility-announcement vectors omit ${type}`);
    }
  }
  for (const state of ["idle", "inProgress"]) {
    if (!states.has(state)) {
      errors.push(`accessibility-announcement vectors omit a ${state} Button`);
    }
  }
  // The rulings these vectors pin are about what is present and what is absent,
  // so the corpus must contain both sides of each optional segment.
  const hasSegment = (type, segment) =>
    cases.some(
      (entry) =>
        entry.componentType === type &&
        entry.elements.some((element) => element.segment === segment),
    );
  const lacksSegment = (type, segment) =>
    cases.some(
      (entry) =>
        entry.componentType === type &&
        !entry.elements.some((element) => element.segment === segment),
    );
  for (const [type, segment] of [
    ["socialProof", "rating"],
    ["award", "subtitle"],
    ["timeline", "description"],
  ]) {
    if (!hasSegment(type, segment) || !lacksSegment(type, segment)) {
      errors.push(
        `accessibility-announcement vectors must exercise ${type} with and ` +
          `without a ${segment}`,
      );
    }
  }
  if (
    !cases.some(
      (entry) => entry.componentType === "button" && entry.container.value,
    )
  ) {
    errors.push(
      "accessibility-announcement vectors never exercise the busy Button value",
    );
  }
  if (new Set(cases.map((entry) => entry.locale)).size < 2) {
    errors.push(
      "accessibility-announcement vectors must exercise more than one catalog",
    );
  }
  return errors;
}

export function validateV03JsonFormatting() {
  const errors = [];
  for (const filePath of Object.values(protocolV03Paths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
    if (source !== formatted) {
      errors.push(`${relative(protocolV03Root, filePath)} is not canonical JSON`);
    }
  }
  return errors;
}
