import Ajv2020 from "ajv/dist/2020.js";

import compatibilityManifest from "../compatibility/v0.1.json" with { type: "json" };
import localProjectSchema from "../schema/local-preview/v0.1/local-project.schema.json" with { type: "json" };
import previewMessageSchema from "../schema/local-preview/v0.1/preview-message.schema.json" with { type: "json" };
import paywallSchema from "../schema/v0.1/paywall.schema.json" with { type: "json" };

export const localPreviewContractVersion =
  previewMessageSchema.properties.previewProtocolVersion.const;
export const localPreviewWebSocketProtocol =
  `mosaic.local-preview.v${localPreviewContractVersion}`;
export const previewMessageTypes = Object.freeze([
  ...previewMessageSchema.properties.type.enum,
]);
export const requiredPreviewCapabilities = Object.freeze([
  ...previewMessageSchema.$defs.previewCapabilityName.enum,
]);
export const canonicalSchemas = Object.freeze({
  paywall: paywallSchema,
  previewMessage: previewMessageSchema,
  localProject: localProjectSchema,
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(paywallSchema);
const validatePaywallSchema = ajv.getSchema(paywallSchema.$id);
const validatePreviewMessageSchema = ajv.compile(previewMessageSchema);
const validateLocalProjectSchema = ajv.compile(localProjectSchema);

if (!validatePaywallSchema) {
  throw new Error("Canonical Mosaic paywall schema was not registered.");
}

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

  function visit(node, path) {
    if (!node || typeof node !== "object") return;
    entries.push({ node, path });
    if (node.type === "scrollContainer") {
      visit(node.content, `${path}/content`);
    } else if (node.type === "verticalStack") {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child, `${path}/children/${index}`);
      }
    }
  }

  visit(document.layout, "/layout");
  return entries;
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
    if (node.accessibility) capabilities.add("accessibility.metadata");
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
  const nodeEntries = walkDocumentNodes(document);
  const expectedCapabilities = expectedDocumentCapabilities(
    document,
    nodeEntries,
  );
  const declaredCapabilities = document.compatibility.requiredCapabilities;
  const declaredByName = new Map();
  const supportedByName = new Map(
    compatibilityManifest.capabilities.map((capability) => [
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
