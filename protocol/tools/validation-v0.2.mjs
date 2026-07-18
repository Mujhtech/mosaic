import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const protocolV02Root = resolve(toolsDirectory, "..");

export const protocolV02Paths = Object.freeze({
  canonicalFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/complete-paywall.json",
  ),
  edgeFixture: resolve(protocolV02Root, "fixtures/v0.2/edge-cases.json"),
  expiredCountdownFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/expired-countdown.json",
  ),
  hiddenPurchaseTargetFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/hidden-purchase-target.json",
  ),
  navigationOnlyFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/navigation-only.json",
  ),
  invalidFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/noncanonical-color.json",
  ),
  invalidExternalUrlFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/insecure-external-url.json",
  ),
  invalidInteractiveButtonChildFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/interactive-button-child.json",
  ),
  invalidNavigationCycleFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/navigation-cycle.json",
  ),
  invalidProductCardOwnershipFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/product-card-outside-selector.json",
  ),
  invalidProductCardDefaultFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/incomplete-product-card-default.json",
  ),
  invalidDuplicateProductReferenceFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/duplicate-product-reference.json",
  ),
  invalidInteractiveProductCardChildFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/interactive-product-card-child.json",
  ),
  invalidUnsafeProductTemplateFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/unsafe-product-template.json",
  ),
  compatibilityManifest: resolve(protocolV02Root, "compatibility/v0.2.json"),
  compatibilityManifestSchema: resolve(
    protocolV02Root,
    "schema/v0.2/compatibility-manifest.schema.json",
  ),
  paywallSchema: resolve(protocolV02Root, "schema/v0.2/paywall.schema.json"),
});

const capabilityByType = Object.freeze({
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
  stack: "layout.stack",
  switch: "component.switch",
  text: "component.text",
});

const requiredCanonicalComponentTypes = Object.freeze([
  "button",
  "carousel",
  "countdown",
  "featureList",
  "icon",
  "image",
  "productBadge",
  "productCard",
  "productSelector",
  "switch",
  "text",
]);

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

const eligibleSizingTypes = new Set([
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

const countdownUnitOrder = Object.freeze({
  day: 0,
  hour: 1,
  minute: 2,
  second: 3,
});

const externalUrlPattern =
  /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$/u;
const productTemplatePattern = /\{\{\s*product\.(name|price)\s*\}\}/gu;

export function readV02Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadProtocolV02Artifacts() {
  return {
    document: readV02Json(protocolV02Paths.canonicalFixture),
    edgeDocument: readV02Json(protocolV02Paths.edgeFixture),
    expiredCountdownDocument: readV02Json(
      protocolV02Paths.expiredCountdownFixture,
    ),
    hiddenPurchaseTargetDocument: readV02Json(
      protocolV02Paths.hiddenPurchaseTargetFixture,
    ),
    navigationOnlyDocument: readV02Json(
      protocolV02Paths.navigationOnlyFixture,
    ),
    invalidDocument: readV02Json(protocolV02Paths.invalidFixture),
    invalidDocuments: [
      readV02Json(protocolV02Paths.invalidFixture),
      readV02Json(protocolV02Paths.invalidExternalUrlFixture),
      readV02Json(protocolV02Paths.invalidInteractiveButtonChildFixture),
      readV02Json(protocolV02Paths.invalidNavigationCycleFixture),
      readV02Json(protocolV02Paths.invalidProductCardOwnershipFixture),
      readV02Json(protocolV02Paths.invalidProductCardDefaultFixture),
      readV02Json(protocolV02Paths.invalidDuplicateProductReferenceFixture),
      readV02Json(protocolV02Paths.invalidInteractiveProductCardChildFixture),
      readV02Json(protocolV02Paths.invalidUnsafeProductTemplateFixture),
    ],
    manifest: readV02Json(protocolV02Paths.compatibilityManifest),
    manifestSchema: readV02Json(protocolV02Paths.compatibilityManifestSchema),
    paywallSchema: readV02Json(protocolV02Paths.paywallSchema),
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

export function walkV02DocumentNodes(document) {
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

export function expectedV02DocumentCapabilities(document) {
  const capabilities = new Set([
    "navigation.screens",
    "localization.catalogs",
  ]);
  const entries = walkV02DocumentNodes(document);
  const designSystem = document.designSystem ?? {
    colors: [],
    backgrounds: [],
    shadows: [],
  };

  if (documentUsesProductTemplates(document, entries)) {
    capabilities.add("localization.productTemplate");
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

export function orderedV02Capabilities(document, paywallSchema) {
  const expected = expectedV02DocumentCapabilities(document);
  return paywallSchema.$defs.capabilityName.enum
    .filter((name) => expected.has(name))
    .map((name) => ({ name, version: "0.2" }));
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

  const expected = expectedV02DocumentCapabilities(document);
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
  }
  addUniqueFieldValues(errors, identifiable, "id", "layout tree");
  for (const { node } of entries) {
    if (node.type === "featureList") {
      addUniqueFieldValues(errors, node.items, "id", `feature list ${node.id}`);
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
  for (const { node } of entries) {
    if (node.type !== "image") continue;
    const asset = assets.get(node.assetId);
    if (!asset) {
      errors.push(`image ${node.id} references unknown asset ${node.assetId}`);
    } else if (asset.type !== "image") {
      errors.push(`image ${node.id} must reference an image asset`);
    } else {
      referenced.add(node.assetId);
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

function validateLocalization(errors, document) {
  const { defaultLocale, fallbackLocale, locales } = document.localization;
  if (!Object.hasOwn(locales, defaultLocale)) {
    errors.push(`localization default locale ${defaultLocale} is not declared`);
  }
  if (!Object.hasOwn(locales, fallbackLocale)) {
    errors.push(`localization fallback locale ${fallbackLocale} is not declared`);
  }
  if (!Object.hasOwn(locales, defaultLocale)) return;

  const templateAllowed = new Set();
  for (const { node, ancestors } of walkV02DocumentNodes(document)) {
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
  for (const key of Object.keys(defaultStrings)) {
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
  const navigationEdges = new Map(
    document.screens.map((screen) => [screen.id, new Set()]),
  );
  const interactiveButtonDescendants = new Set([
    "button",
    "productSelector",
    "switch",
    "carousel",
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

export function resolveV02ColorToken(document, color) {
  return resolveTokenValue(document, "colors", "colorToken", color);
}

export function resolveV02BackgroundToken(document, background) {
  return resolveTokenValue(
    document,
    "backgrounds",
    "backgroundToken",
    background,
  );
}

export function resolveV02ShadowToken(document, shadow) {
  return resolveTokenValue(document, "shadows", "shadowToken", shadow);
}

export function resolveV02AxisSizing(
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

export function resolveV02MediaBackgroundFallback(
  document,
  background,
  availableAssetIds,
) {
  const resolved = resolveV02BackgroundToken(document, background);
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

export function evaluateV02Visibility(visibility, switchValues = {}) {
  if (!visibility || visibility.mode === "always") return true;
  if (visibility.mode === "hidden") return false;
  return switchValues[visibility.switchId] === visibility.equals;
}

function entryIsVisible(entry, switchValues) {
  return [...entry.ancestors, entry.node].every((node) =>
    evaluateV02Visibility(node.visibility, switchValues),
  );
}

export function runtimeStateForAcceptedV02Revision(document) {
  const entries = walkV02DocumentNodes(document);
  return {
    switches: initialSwitchValues(entries),
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

export function resolveV02CountdownState(countdown, now) {
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

export function protocolV02RuntimeDiagnostics(
  document,
  switchValues,
  navigationState,
) {
  const entries = walkV02DocumentNodes(document);
  const effectiveSwitchValues = switchValues ?? initialSwitchValues(entries);
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
    if (selectorEntry && !entryIsVisible(selectorEntry, effectiveSwitchValues)) {
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

export function applyV02NavigationAction(navigationState, action) {
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

export function protocolV02AuthoringWarnings(document) {
  const warnings = [];
  for (const { node } of walkV02DocumentNodes(document)) {
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
          ? resolveV02ColorToken(document, descendant.typography.color)
          : null;
        const field = descendant.id;
        const resolvedBackground = style.background
          ? resolveV02BackgroundToken(document, style.background)
          : null;
        const background =
          resolvedBackground?.type === "color"
            ? resolveV02ColorToken(document, resolvedBackground.value)
            : null;
        if (!foreground) continue;
        if (!background) continue;
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

export function validateProtocolV02({
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
  const entries = walkV02DocumentNodes(document);
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
  validateLocalization(errors, document);
  validateLayoutAndRuntime(errors, document, entries);
  return errors;
}

export function validateCanonicalV02Coverage(document) {
  const errors = [];
  const entries = walkV02DocumentNodes(document);
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
  return errors;
}

export function validateV02JsonFormatting() {
  const errors = [];
  for (const filePath of Object.values(protocolV02Paths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
    if (source !== formatted) {
      errors.push(`${relative(protocolV02Root, filePath)} is not canonical JSON`);
    }
  }
  return errors;
}
