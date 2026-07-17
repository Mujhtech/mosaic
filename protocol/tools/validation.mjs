import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const protocolRoot = resolve(toolsDirectory, "..");

export const protocolPaths = Object.freeze({
  canonicalFixture: resolve(
    protocolRoot,
    "fixtures/v0.1/complete-paywall.json",
  ),
  compatibilityManifest: resolve(protocolRoot, "compatibility/v0.1.json"),
  compatibilityManifestSchema: resolve(
    protocolRoot,
    "schema/v0.1/compatibility-manifest.schema.json",
  ),
  paywallSchema: resolve(protocolRoot, "schema/v0.1/paywall.schema.json"),
});

const capabilityByType = Object.freeze({
  closeButton: "component.closeButton",
  featureList: "component.featureList",
  image: "component.image",
  legalText: "component.legalText",
  productSelector: "component.productSelector",
  purchaseButton: "component.purchaseButton",
  restoreButton: "component.restoreButton",
  scrollContainer: "layout.scrollContainer",
  text: "component.text",
  verticalStack: "layout.verticalStack",
});

const requiredCanonicalComponentTypes = Object.freeze([
  "closeButton",
  "featureList",
  "image",
  "legalText",
  "productSelector",
  "purchaseButton",
  "restoreButton",
  "text",
]);

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadProtocolArtifacts() {
  return {
    document: readJson(protocolPaths.canonicalFixture),
    manifest: readJson(protocolPaths.compatibilityManifest),
    manifestSchema: readJson(protocolPaths.compatibilityManifestSchema),
    paywallSchema: readJson(protocolPaths.paywallSchema),
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

function addUniqueEntries(errors, entries, label) {
  const seen = new Set();

  for (const entry of entries) {
    if (seen.has(entry.name)) {
      errors.push(`${label} declares capability ${entry.name} more than once`);
    }
    seen.add(entry.name);
  }
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

function capabilityMap(entries) {
  return new Map(entries.map((entry) => [entry.name, entry.version]));
}

export function walkDocumentNodes(document) {
  const nodes = [];

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    nodes.push(node);
    if (node.type === "scrollContainer") {
      visit(node.content);
    } else if (node.type === "verticalStack") {
      for (const child of node.children ?? []) {
        visit(child);
      }
    }
  }

  visit(document.layout);
  return nodes;
}

export function expectedDocumentCapabilities(document) {
  const capabilities = new Set(["localization.catalogs"]);

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

  for (const node of walkDocumentNodes(document)) {
    const capability = capabilityByType[node.type];
    if (capability) {
      capabilities.add(capability);
    }

    if (node.accessibility) {
      capabilities.add("accessibility.metadata");
    }

    if (node.type === "productSelector") {
      capabilities.add("fallback.product");
      capabilities.add("outcome.normalized");
    }

    if (node.action?.type) {
      capabilities.add(`action.${node.action.type}`);
      capabilities.add("outcome.normalized");
    }
  }

  return capabilities;
}

function validateDocumentCapabilities(errors, document, manifest, paywallSchema) {
  const declared = document.compatibility.requiredCapabilities;
  const supported = manifest.capabilities;
  const expected = expectedDocumentCapabilities(document);
  const declaredMap = capabilityMap(declared);
  const supportedMap = capabilityMap(supported);

  addUniqueEntries(errors, declared, "document");
  addUniqueEntries(errors, supported, "manifest");

  for (const capability of expected) {
    if (!declaredMap.has(capability)) {
      errors.push(`document is missing required capability ${capability}`);
    }
  }

  for (const capability of declaredMap.keys()) {
    if (!expected.has(capability)) {
      errors.push(`document declares unused capability ${capability}`);
    }
  }

  for (const [capability, version] of declaredMap) {
    if (!supportedMap.has(capability)) {
      errors.push(`manifest does not support required capability ${capability}`);
      continue;
    }

    if (supportedMap.get(capability) !== version) {
      errors.push(
        `manifest supports ${capability}@${supportedMap.get(capability)}, ` +
          `but the document requires ${capability}@${version}`,
      );
    }
  }

  const manifestCapabilities = new Set(
    manifest.capabilities.map((capability) => capability.name),
  );
  for (const capability of paywallSchema.$defs.capabilityName.enum) {
    if (!manifestCapabilities.has(capability)) {
      errors.push(`manifest omits schema capability ${capability}`);
    }
  }
}

function validateSchemaCapabilityAgreement(
  errors,
  paywallSchema,
  manifestSchema,
) {
  const documentCapabilities = new Set(
    paywallSchema.$defs.capabilityName.enum,
  );
  const manifestCapabilities = new Set(
    manifestSchema.$defs.capabilityName.enum,
  );

  for (const capability of documentCapabilities) {
    if (!manifestCapabilities.has(capability)) {
      errors.push(`manifest schema omits paywall capability ${capability}`);
    }
  }
  for (const capability of manifestCapabilities) {
    if (!documentCapabilities.has(capability)) {
      errors.push(`manifest schema declares unknown capability ${capability}`);
    }
  }
}

function validateNodeIdentifiers(errors, nodes) {
  addUniqueFieldValues(errors, nodes, "id", "layout tree");

  for (const node of nodes) {
    if (node.type !== "featureList") {
      continue;
    }

    addUniqueFieldValues(
      errors,
      node.items,
      "id",
      `feature list ${node.id}`,
    );
  }
}

function validateAssetReferences(errors, document, nodes) {
  addUniqueFieldValues(errors, document.assets, "id", "asset catalog");
  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const referencedAssets = new Set();

  for (const node of nodes) {
    if (node.type !== "image") {
      continue;
    }

    const asset = assetsById.get(node.assetId);
    if (!asset) {
      errors.push(`image ${node.id} references unknown asset ${node.assetId}`);
      continue;
    }
    if (asset.type !== "image") {
      errors.push(`image ${node.id} references non-image asset ${node.assetId}`);
    }
    referencedAssets.add(node.assetId);
  }

  for (const asset of document.assets) {
    if (!referencedAssets.has(asset.id)) {
      errors.push(`asset catalog declares unused asset ${asset.id}`);
    }
  }
}

function validateProductReferences(errors, document, nodes) {
  addUniqueFieldValues(errors, document.products, "id", "product catalog");
  addUniqueFieldValues(
    errors,
    document.products,
    "productId",
    "product catalog",
  );

  const productsById = new Map(
    document.products.map((product) => [product.id, product]),
  );
  const referencedProducts = new Set();
  const selectorsById = new Map();
  const purchaseSelectorIds = new Set();

  for (const node of nodes) {
    if (node.type === "productSelector") {
      selectorsById.set(node.id, node);
      const referenceIds = node.productReferenceIds;

      for (const referenceId of referenceIds) {
        if (!productsById.has(referenceId)) {
          errors.push(
            `product selector ${node.id} references unknown product ${referenceId}`,
          );
        }
        referencedProducts.add(referenceId);
      }

      if (!referenceIds.includes(node.initiallySelectedProductReferenceId)) {
        errors.push(
          `product selector ${node.id} initially selects an undeclared product`,
        );
      }
    }

    if (node.type === "purchaseButton") {
      purchaseSelectorIds.add(node.action.productSelectorId);
    }
  }

  for (const node of nodes) {
    if (node.type !== "purchaseButton") {
      continue;
    }

    const target = selectorsById.get(node.action.productSelectorId);
    if (!target) {
      errors.push(
        `purchase button ${node.id} references unknown product selector ` +
          node.action.productSelectorId,
      );
    }
  }

  for (const selector of selectorsById.values()) {
    if (!purchaseSelectorIds.has(selector.id)) {
      errors.push(`product selector ${selector.id} has no purchase action`);
    }
  }

  for (const product of document.products) {
    if (!referencedProducts.has(product.id)) {
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

  if (!value || typeof value !== "object") {
    return;
  }

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

  if (!Object.hasOwn(locales, defaultLocale)) {
    return;
  }

  const localizedEntries = [];
  collectLocalizedText(document.assets, "/assets", localizedEntries);
  collectLocalizedText(document.products, "/products", localizedEntries);
  collectLocalizedText(document.layout, "/layout", localizedEntries);

  const referencedKeys = new Set();
  const defaultStrings = locales[defaultLocale].strings;

  for (const { path, text } of localizedEntries) {
    referencedKeys.add(text.localizationKey);
    if (!Object.hasOwn(defaultStrings, text.localizationKey)) {
      errors.push(
        `${path} references missing default localization key ` +
          text.localizationKey,
      );
      continue;
    }

    if (defaultStrings[text.localizationKey] !== text.default) {
      errors.push(
        `${path} default text does not match ${defaultLocale} catalog key ` +
          text.localizationKey,
      );
    }
  }

  for (const key of Object.keys(defaultStrings)) {
    if (!referencedKeys.has(key)) {
      errors.push(`default localization catalog declares unused key ${key}`);
    }
  }

  for (const [locale, catalog] of Object.entries(locales)) {
    if (locale === defaultLocale) {
      continue;
    }

    for (const key of Object.keys(catalog.strings)) {
      if (!Object.hasOwn(defaultStrings, key)) {
        errors.push(`localization catalog ${locale} declares unknown key ${key}`);
      }
    }
  }
}

function localeCandidates(document, requestedLocale) {
  const { defaultLocale, fallbackLocale, locales } = document.localization;
  const candidates = [];

  function add(locale) {
    if (locale && !candidates.includes(locale)) {
      candidates.push(locale);
    }
  }

  if (requestedLocale) {
    add(requestedLocale);
    add(requestedLocale.split("-")[0]);
    add(fallbackLocale);
    add(defaultLocale);
  } else {
    add(defaultLocale);
    add(fallbackLocale);
  }

  return candidates.filter((locale) => Object.hasOwn(locales, locale));
}

export function resolveLocalizedText(document, localizedText, requestedLocale) {
  const candidates = localeCandidates(document, requestedLocale);
  const directionLocale = candidates[0] ?? document.localization.defaultLocale;
  const direction =
    document.localization.locales[directionLocale]?.direction ?? "ltr";

  for (const locale of candidates) {
    const strings = document.localization.locales[locale].strings;
    if (Object.hasOwn(strings, localizedText.localizationKey)) {
      return {
        direction,
        locale,
        value: strings[localizedText.localizationKey],
      };
    }
  }

  return {
    direction,
    locale: null,
    value: localizedText.default,
  };
}

export function validateCanonicalFixtureCoverage(document) {
  const errors = [];
  const nodes = walkDocumentNodes(document);
  const componentTypes = new Set(nodes.map((node) => node.type));

  for (const componentType of requiredCanonicalComponentTypes) {
    if (!componentTypes.has(componentType)) {
      errors.push(`canonical fixture omits component ${componentType}`);
    }
  }

  if (
    !nodes.some(
      (node) =>
        node.type === "verticalStack" && node !== document.layout?.content,
    )
  ) {
    errors.push("canonical fixture does not exercise nested vertical stacks");
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

  return errors;
}

export function validateProtocol({
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

  if (!documentIsValid || !manifestIsValid) {
    return errors;
  }

  if (document.schemaVersion !== manifest.schemaVersion) {
    errors.push(
      `document schema version ${document.schemaVersion} does not match ` +
        `manifest version ${manifest.schemaVersion}`,
    );
  }

  const nodes = walkDocumentNodes(document);
  validateSchemaCapabilityAgreement(errors, paywallSchema, manifestSchema);
  validateDocumentCapabilities(errors, document, manifest, paywallSchema);
  validateNodeIdentifiers(errors, nodes);
  validateAssetReferences(errors, document, nodes);
  validateProductReferences(errors, document, nodes);
  validateLocalization(errors, document);

  return errors;
}

export function validateJsonFormatting() {
  const errors = [];

  for (const filePath of Object.values(protocolPaths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;

    if (source !== formatted) {
      errors.push(`${relative(protocolRoot, filePath)} is not canonical JSON`);
    }
  }

  return errors;
}
