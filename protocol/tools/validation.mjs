import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const protocolRoot = resolve(toolsDirectory, "..");

export const protocolPaths = Object.freeze({
  canonicalFixture: resolve(
    protocolRoot,
    "fixtures/v0.1/minimal-paywall.json",
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
  legalText: "component.legalText",
  productSelector: "component.productSelector",
  purchaseButton: "component.purchaseButton",
  restoreButton: "component.restoreButton",
  text: "component.text",
});

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

function capabilityMap(entries) {
  return new Map(entries.map((entry) => [entry.name, entry.version]));
}

function expectedDocumentCapabilities(document) {
  const capabilities = new Set();

  if (document.layout?.type === "vertical") {
    capabilities.add("layout.vertical");
  }

  for (const component of document.layout?.children ?? []) {
    const capability = capabilityByType[component.type];
    if (capability) {
      capabilities.add(capability);
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

function validateProductSelection(errors, document) {
  for (const component of document.layout.children) {
    if (component.type !== "productSelector") {
      continue;
    }

    const productIds = component.products.map((product) => product.productId);
    if (new Set(productIds).size !== productIds.length) {
      errors.push(`product selector ${component.id} contains duplicate product IDs`);
    }

    if (!productIds.includes(component.initiallySelectedProductId)) {
      errors.push(
        `product selector ${component.id} initially selects an undeclared product`,
      );
    }
  }
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

  validateDocumentCapabilities(errors, document, manifest, paywallSchema);
  validateProductSelection(errors, document);

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
