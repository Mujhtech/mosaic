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
  invalidFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/invalid/noncanonical-color.json",
  ),
  migratedFixture: resolve(
    protocolV02Root,
    "fixtures/v0.2/migrated-v0.1.json",
  ),
  compatibilityManifest: resolve(protocolV02Root, "compatibility/v0.2.json"),
  compatibilityManifestSchema: resolve(
    protocolV02Root,
    "schema/v0.2/compatibility-manifest.schema.json",
  ),
  paywallSchema: resolve(protocolV02Root, "schema/v0.2/paywall.schema.json"),
});

const capabilityByType = Object.freeze({
  carousel: "component.carousel",
  closeButton: "component.closeButton",
  countdown: "component.countdown",
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
});

const requiredCanonicalComponentTypes = Object.freeze([
  "carousel",
  "closeButton",
  "countdown",
  "featureList",
  "image",
  "legalText",
  "productSelector",
  "purchaseButton",
  "restoreButton",
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

const countdownUnitOrder = Object.freeze({
  day: 0,
  hour: 1,
  minute: 2,
  second: 3,
});

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
    invalidDocument: readV02Json(protocolV02Paths.invalidFixture),
    migratedDocument: readV02Json(protocolV02Paths.migratedFixture),
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

  function visit(node, ancestors = []) {
    if (!node || typeof node !== "object") return;
    entries.push({ node, ancestors });

    if (node.type === "scrollContainer") {
      visit(node.content, [...ancestors, node]);
    } else if (node.type === "stack") {
      for (const child of node.children ?? []) {
        visit(child, [...ancestors, node]);
      }
    } else if (node.type === "carousel") {
      for (const page of node.pages ?? []) {
        visit(page.content, [...ancestors, node]);
      }
    }
  }

  visit(document.layout);
  return entries;
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

export function expectedV02DocumentCapabilities(document) {
  const capabilities = new Set(["localization.catalogs"]);
  const entries = walkV02DocumentNodes(document);

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
  if ((document.assets?.length ?? 0) > 0) {
    capabilities.add("asset.bundledImage");
    capabilities.add("fallback.asset");
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
    if (node.type === "productSelector") {
      capabilities.add("fallback.product");
      capabilities.add("outcome.normalized");
      capabilities.add("style.productCardStates");
    }
    if (node.action?.type) {
      capabilities.add(`action.${node.action.type}`);
      capabilities.add("outcome.normalized");
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

function validateIdentifiers(errors, entries) {
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

function validateAssetReferences(errors, document, entries) {
  addUniqueFieldValues(errors, document.assets, "id", "asset catalog");
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const referenced = new Set();
  for (const { node } of entries) {
    if (node.type !== "image") continue;
    if (!assets.has(node.assetId)) {
      errors.push(`image ${node.id} references unknown asset ${node.assetId}`);
    } else {
      referenced.add(node.assetId);
    }
  }
  for (const asset of document.assets) {
    if (!referenced.has(asset.id)) {
      errors.push(`asset catalog declares unused asset ${asset.id}`);
    }
  }
}

function validateProductReferences(errors, document, entries) {
  addUniqueFieldValues(errors, document.products, "id", "product catalog");
  addUniqueFieldValues(errors, document.products, "productId", "product catalog");
  const products = new Map(document.products.map((product) => [product.id, product]));
  const referenced = new Set();
  const selectors = new Map();
  const purchaseTargets = new Set();

  for (const { node } of entries) {
    if (node.type === "productSelector") {
      selectors.set(node.id, node);
      for (const id of node.productReferenceIds) {
        if (!products.has(id)) {
          errors.push(`product selector ${node.id} references unknown product ${id}`);
        }
        referenced.add(id);
      }
      if (
        !node.productReferenceIds.includes(
          node.initiallySelectedProductReferenceId,
        )
      ) {
        errors.push(
          `product selector ${node.id} initially selects an undeclared product`,
        );
      }
    } else if (node.type === "purchaseButton") {
      purchaseTargets.add(node.action.productSelectorId);
    }
  }

  for (const { node } of entries) {
    if (node.type !== "purchaseButton") continue;
    if (!selectors.has(node.action.productSelectorId)) {
      errors.push(
        `purchase button ${node.id} references unknown product selector ` +
          node.action.productSelectorId,
      );
    }
  }
  for (const selector of selectors.values()) {
    if (!purchaseTargets.has(selector.id)) {
      errors.push(`product selector ${selector.id} has no purchase action`);
    }
  }
  for (const product of document.products) {
    if (!referenced.has(product.id)) {
      errors.push(`product catalog declares unused product ${product.id}`);
    }
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
    collectLocalizedText(entry, `${path}/${key}`, entries);
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

  const entries = [];
  collectLocalizedText(document.assets, "/assets", entries);
  collectLocalizedText(document.products, "/products", entries);
  collectLocalizedText(document.layout, "/layout", entries);
  const referenced = new Set();
  const defaultStrings = locales[defaultLocale].strings;

  for (const { path, text } of entries) {
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
  if (document.layout.content.direction !== "vertical") {
    errors.push("root scroll content must be a vertical stack");
  }
  if (document.layout.content.children.length === 0) {
    errors.push("root scroll content must contain at least one child");
  }

  const switches = new Map(
    entries
      .filter(({ node }) => node.type === "switch")
      .map(({ node }) => [node.id, node]),
  );
  for (const { node, ancestors } of entries) {
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
      } else if (controller.id === node.id) {
        errors.push(
          `${node.type} ${node.id} visibility cannot reference itself`,
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
  const base = productSelector.cardStyles.default;
  if (!selected) return structuredClone(base);
  return recursiveOverlay(base, productSelector.cardStyles.selected);
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

export function protocolV02RuntimeDiagnostics(document, switchValues) {
  const entries = walkV02DocumentNodes(document);
  const effectiveSwitchValues = switchValues ?? initialSwitchValues(entries);
  const selectors = new Map(
    entries
      .filter(({ node }) => node.type === "productSelector")
      .map((entry) => [entry.node.id, entry]),
  );
  const diagnostics = [];
  for (const { node } of entries) {
    if (node.type !== "purchaseButton") continue;
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
    if (node.type !== "productSelector") continue;
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
      for (const [field, foreground, background] of [
        ["productLabelColor", style.productLabelColor, style.background],
        ["runtimePriceColor", style.runtimePriceColor, style.background],
        ["badge.textColor", style.badge.textColor, style.badge.background],
      ]) {
        if (hasKnownLowContrast(foreground, background)) {
          warnings.push({
            code: "productCard.lowContrast",
            componentId: node.id,
            state,
            field,
            message: `Product Card ${state} ${field} has known low contrast.`,
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
  validateIdentifiers(errors, entries);
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
