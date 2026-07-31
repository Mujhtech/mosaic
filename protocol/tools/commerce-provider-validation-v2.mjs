import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const commerceProviderV2Root = resolve(toolsDirectory, "..");

export const commerceProviderV2Paths = Object.freeze({
  contractSchema: resolve(
    commerceProviderV2Root,
    "schema/commerce-provider/v2/contract.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    commerceProviderV2Root,
    "schema/commerce-provider/v2/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    commerceProviderV2Root,
    "compatibility/commerce-provider/v2.json",
  ),
  fixtureDirectory: resolve(
    commerceProviderV2Root,
    "fixtures/commerce-provider/v2",
  ),
});

export function readCommerceProviderV2Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixturePaths() {
  return readdirSync(commerceProviderV2Paths.fixtureDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(commerceProviderV2Paths.fixtureDirectory, name));
}

export function loadCommerceProviderV2Artifacts() {
  const paths = fixturePaths();
  return {
    contractSchema: readCommerceProviderV2Json(
      commerceProviderV2Paths.contractSchema,
    ),
    compatibilityManifestSchema: readCommerceProviderV2Json(
      commerceProviderV2Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readCommerceProviderV2Json(
      commerceProviderV2Paths.compatibilityManifest,
    ),
    fixturePaths: paths,
    fixtures: paths.map(readCommerceProviderV2Json),
  };
}

function validators({ contractSchema, compatibilityManifestSchema }) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return {
    contract: ajv.compile(contractSchema),
    compatibilityManifest: ajv.compile(compatibilityManifestSchema),
  };
}

function schemaErrors(label, errors = []) {
  return errors.map(
    (error) =>
      `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}

function duplicates(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function requireUnique(errors, values, label) {
  for (const value of duplicates(values)) {
    errors.push(`${label} contains duplicate ${value}`);
  }
}

const nativeCapabilitySupport = Object.freeze({
  app_store: Object.freeze({
    productLoading: "supported",
    subscriptions: "supported",
    oneTimeNonConsumables: "supported",
    trials: "supported",
    introductoryOffers: "supported",
    promotionalOffers: "conditional",
    restore: "supported",
    activeEntitlementLookup: "supported",
    pendingPurchases: "supported",
    deferredPurchases: "unsupported",
    serverConfirmedTransactions: "unsupported",
    productSynchronization: "unsupported",
    providerDiagnostics: "supported",
    basePlans: "unsupported",
    explicitOffers: "unsupported",
    storeSynchronization: "supported",
    activePurchaseRecovery: "unsupported",
    asynchronousCommerceUpdates: "supported",
    localDeliveryAcceptance: "supported",
  }),
  google_play: Object.freeze({
    productLoading: "supported",
    subscriptions: "supported",
    oneTimeNonConsumables: "supported",
    trials: "conditional",
    introductoryOffers: "conditional",
    promotionalOffers: "unsupported",
    restore: "supported",
    activeEntitlementLookup: "supported",
    pendingPurchases: "supported",
    deferredPurchases: "unsupported",
    serverConfirmedTransactions: "unsupported",
    productSynchronization: "unsupported",
    providerDiagnostics: "supported",
    basePlans: "supported",
    explicitOffers: "supported",
    storeSynchronization: "unsupported",
    activePurchaseRecovery: "supported",
    asynchronousCommerceUpdates: "supported",
    localDeliveryAcceptance: "supported",
  }),
});

function nativeCapabilitySemantics(errors, providerId, capabilities, label) {
  const expected = nativeCapabilitySupport[providerId];
  if (expected === undefined) return;
  const actual = new Map(
    capabilities.map((capability) => [capability.name, capability.support]),
  );
  for (const [name, support] of Object.entries(expected)) {
    if (actual.get(name) !== support) {
      errors.push(
        `${label} ${providerId} capability ${name} must be ${support}`,
      );
    }
  }
  if (capabilities.length !== Object.keys(expected).length) {
    errors.push(
      `${label} ${providerId} must declare the complete native capability set`,
    );
  }
}

export { nativeCapabilitySupport };

function diagnosticSemantics(errors, diagnostics, label) {
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!diagnostic.retryable && diagnostic.retryAfterSeconds !== undefined) {
      errors.push(
        `${label}[${index}] cannot provide retryAfterSeconds when retryable is false`,
      );
    }
  }
}

function freshnessSemantics(errors, freshness, label) {
  if (
    freshness.expiresAt !== undefined &&
    Date.parse(freshness.expiresAt) < Date.parse(freshness.observedAt)
  ) {
    errors.push(`${label} expiresAt precedes observedAt`);
  }
}

function productSemantics(errors, product, label) {
  requireUnique(
    errors,
    product.entitlementKeys,
    `${label}.entitlementKeys`,
  );
}

function resolvedProductSemantics(errors, resolved, label) {
  productSemantics(errors, resolved.product, `${label}.product`);
  freshnessSemantics(errors, resolved.freshness, `${label}.freshness`);
  diagnosticSemantics(errors, resolved.diagnostics, `${label}.diagnostics`);

  if (
    resolved.availability.status === "available" &&
    resolved.availability.reason !== undefined
  ) {
    errors.push(`${label} is available but has an unavailable reason`);
  }
  if (
    resolved.availability.status !== "available" &&
    resolved.availability.reason === undefined
  ) {
    errors.push(
      `${label} is ${resolved.availability.status} without an availability reason`,
    );
  }
  if (
    resolved.availability.status === "available" &&
    resolved.metadata === undefined
  ) {
    errors.push(`${label} is available but has no resolved metadata`);
  }

  if (
    resolved.product.type === "subscription" &&
    resolved.availability.status === "available" &&
    resolved.metadata?.billingPeriod === undefined
  ) {
    errors.push(`${label} is an available subscription without a billing period`);
  }

  if (
    resolved.product.type === "one_time_non_consumable" &&
    resolved.metadata !== undefined &&
    (resolved.metadata.billingPeriod !== undefined ||
      resolved.metadata.trial !== undefined ||
      resolved.metadata.introductoryOffer !== undefined)
  ) {
    errors.push(
      `${label} is a one-time non-consumable with subscription-only metadata`,
    );
  }
}

function failureDiagnostics(errors, payload, failureOutcomes, label) {
  if (
    failureOutcomes.has(payload.outcome) &&
    !payload.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    errors.push(`${label} ${payload.outcome} requires an error diagnostic`);
  }
}

export function validateCommerceProviderV2Record(record, contractSchema) {
  const validate = validators({
    contractSchema,
    compatibilityManifestSchema: {
      type: "object",
    },
  }).contract;
  if (!validate(record)) {
    return schemaErrors(
      `Commerce Provider ${record?.recordType ?? "record"}`,
      validate.errors,
    );
  }

  const errors = [];
  const payload = record.payload;
  switch (record.recordType) {
    case "providerProfile":
      requireUnique(
        errors,
        payload.capabilities.map((capability) => capability.name),
        "providerProfile.capabilities",
      );
      payload.capabilities.forEach((capability) => {
        if (
          capability.support === "supported" &&
          capability.reasonCode !== undefined
        ) {
          errors.push(
            `providerProfile capability ${capability.name} is supported but has a reasonCode`,
          );
        }
        if (
          capability.support !== "supported" &&
          capability.reasonCode === undefined
        ) {
          errors.push(
            `providerProfile capability ${capability.name} is ${capability.support} without a reasonCode`,
          );
        }
      });
      nativeCapabilitySemantics(
        errors,
        payload.provider.id,
        payload.capabilities,
        "providerProfile",
      );
      if (
        payload.recoveryMode === "storeSynchronization" &&
        !payload.capabilities.some(
          (capability) =>
            capability.name === "storeSynchronization" &&
            capability.support === "supported",
        )
      ) {
        errors.push(
          "providerProfile storeSynchronization recovery mode requires supported storeSynchronization capability",
        );
      }
      if (
        payload.recoveryMode === "activePurchaseRecovery" &&
        !payload.capabilities.some(
          (capability) =>
            capability.name === "activePurchaseRecovery" &&
            capability.support === "supported",
        )
      ) {
        errors.push(
          "providerProfile activePurchaseRecovery mode requires supported activePurchaseRecovery capability",
        );
      }
      break;
    case "productLoadRequest":
      requireUnique(
        errors,
        payload.products.map((item) => item.product.mosaicProductId),
        "productLoadRequest Products",
      );
      requireUnique(
        errors,
        payload.products.map((item) => item.binding.mappingId),
        "productLoadRequest mappings",
      );
      payload.products.forEach((item, index) =>
        productSemantics(
          errors,
          item.product,
          `productLoadRequest.products[${index}].product`,
        ),
      );
      break;
    case "productLoadResult":
      requireUnique(
        errors,
        payload.products.map((item) => item.product.mosaicProductId),
        "productLoadResult Products",
      );
      payload.products.forEach((item, index) =>
        resolvedProductSemantics(
          errors,
          item,
          `productLoadResult.products[${index}]`,
        ),
      );
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "productLoadResult.diagnostics",
      );
      break;
    case "purchaseRequest":
      break;
    case "purchaseOutcome":
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "purchaseOutcome.diagnostics",
      );
      failureDiagnostics(
        errors,
        payload,
        new Set(["productUnavailable", "providerUnavailable", "failed"]),
        "purchaseOutcome",
      );
      if (
        ["purchased", "alreadyEntitled"].includes(payload.outcome) &&
        payload.activeEntitlementKeys === undefined
      ) {
        errors.push(
          `purchaseOutcome ${payload.outcome} requires activeEntitlementKeys`,
        );
      }
      if (
        ["pending", "deferred", "cancelled", "productUnavailable", "providerUnavailable", "failed"].includes(
          payload.outcome,
        ) &&
        payload.activeEntitlementKeys !== undefined
      ) {
        errors.push(
          `purchaseOutcome ${payload.outcome} cannot assert active Entitlements`,
        );
      }
      break;
    case "restoreOutcome":
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "restoreOutcome.diagnostics",
      );
      failureDiagnostics(
        errors,
        payload,
        new Set(["providerUnavailable", "failed"]),
        "restoreOutcome",
      );
      if (
        payload.outcome === "restored" &&
        !(payload.activeEntitlementKeys?.length > 0)
      ) {
        errors.push("restoreOutcome restored requires active Entitlements");
      }
      if (
        payload.outcome !== "restored" &&
        payload.activeEntitlementKeys !== undefined
      ) {
        errors.push(
          `restoreOutcome ${payload.outcome} cannot assert active Entitlements`,
        );
      }
      break;
    case "activeEntitlementOutcome":
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "activeEntitlementOutcome.diagnostics",
      );
      failureDiagnostics(
        errors,
        payload,
        new Set(["providerUnavailable", "failed"]),
        "activeEntitlementOutcome",
      );
      if (
        payload.outcome === "available" &&
        (payload.activeEntitlementKeys === undefined ||
          payload.freshness === undefined)
      ) {
        errors.push(
          "activeEntitlementOutcome available requires activeEntitlementKeys and freshness",
        );
      }
      if (
        payload.outcome !== "available" &&
        (payload.activeEntitlementKeys !== undefined ||
          payload.freshness !== undefined)
      ) {
        errors.push(
          `activeEntitlementOutcome ${payload.outcome} cannot assert active Entitlements or freshness`,
        );
      }
      if (payload.freshness !== undefined) {
        freshnessSemantics(
          errors,
          payload.freshness,
          "activeEntitlementOutcome.freshness",
        );
      }
      break;
    case "providerDiagnostics":
      freshnessSemantics(
        errors,
        payload.freshness,
        "providerDiagnostics.freshness",
      );
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "providerDiagnostics.diagnostics",
      );
      if (
        ["degraded", "unavailable"].includes(payload.health) &&
        payload.diagnostics.length === 0
      ) {
        errors.push(
          `providerDiagnostics ${payload.health} requires a diagnostic`,
        );
      }
      break;
    case "commerceUpdate":
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "commerceUpdate.diagnostics",
      );
      failureDiagnostics(
        errors,
        payload,
        new Set(["providerUnavailable", "failed"]),
        "commerceUpdate",
      );
      if (
        ["purchased", "entitlementsChanged"].includes(payload.outcome) &&
        payload.activeEntitlementKeys === undefined
      ) {
        errors.push(
          `commerceUpdate ${payload.outcome} requires activeEntitlementKeys`,
        );
      }
      if (
        payload.outcome === "purchased" &&
        !(payload.activeEntitlementKeys?.length > 0)
      ) {
        errors.push(
          "commerceUpdate purchased requires non-empty activeEntitlementKeys",
        );
      }
      if (
        ["pending", "cancelled", "providerUnavailable", "failed"].includes(
          payload.outcome,
        ) &&
        payload.activeEntitlementKeys !== undefined
      ) {
        errors.push(
          `commerceUpdate ${payload.outcome} cannot assert active Entitlements`,
        );
      }
      break;
    case "commerceUpdateAcceptance":
      diagnosticSemantics(
        errors,
        payload.diagnostics,
        "commerceUpdateAcceptance.diagnostics",
      );
      if (
        ["rejectedStaleConfiguration", "deliveryFailed"].includes(
          payload.disposition,
        ) &&
        !payload.diagnostics.some(
          (diagnostic) => diagnostic.severity === "error",
        )
      ) {
        errors.push(
          `commerceUpdateAcceptance ${payload.disposition} requires an error diagnostic`,
        );
      }
      break;
    default:
      errors.push(`Unsupported Commerce Provider record type ${record.recordType}`);
  }
  return errors;
}

export function validateCommerceProviderV2Artifacts(artifacts) {
  const checks = validators(artifacts);
  const errors = [];
  if (!checks.compatibilityManifest(artifacts.compatibilityManifest)) {
    errors.push(
      ...schemaErrors(
        "Commerce Provider compatibility manifest",
        checks.compatibilityManifest.errors,
      ),
    );
  }

  const manifestSchemaPath = resolve(
    dirname(commerceProviderV2Paths.compatibilityManifest),
    artifacts.compatibilityManifest.schema,
  );
  if (manifestSchemaPath !== commerceProviderV2Paths.contractSchema) {
    errors.push("Commerce Provider manifest does not reference the canonical schema");
  }

  const expectedFixturePaths = artifacts.compatibilityManifest.canonicalFixtures
    .map((fixture) =>
      resolve(dirname(commerceProviderV2Paths.compatibilityManifest), fixture),
    )
    .sort();
  if (
    JSON.stringify(expectedFixturePaths) !==
    JSON.stringify([...artifacts.fixturePaths].sort())
  ) {
    errors.push(
      "Commerce Provider manifest canonicalFixtures do not exactly match the fixture directory",
    );
  }
  for (const fixturePath of expectedFixturePaths) {
    if (!existsSync(fixturePath)) {
      errors.push(
        `Commerce Provider manifest references missing fixture ${relative(
          commerceProviderV2Root,
          fixturePath,
        )}`,
      );
    }
  }

  for (const [index, fixture] of artifacts.fixtures.entries()) {
    const name = relative(
      commerceProviderV2Root,
      artifacts.fixturePaths[index],
    );
    errors.push(
      ...validateCommerceProviderV2Record(
        fixture,
        artifacts.contractSchema,
      ).map((error) => `${name}: ${error}`),
    );
  }
  return errors;
}

export function validateCommerceProviderV2JsonFormatting() {
  const paths = [
    commerceProviderV2Paths.contractSchema,
    commerceProviderV2Paths.compatibilityManifestSchema,
    commerceProviderV2Paths.compatibilityManifest,
    ...fixturePaths(),
  ];
  const errors = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== formatted) {
      errors.push(
        `${relative(commerceProviderV2Root, path)} is not canonical two-space JSON`,
      );
    }
  }
  return errors;
}
