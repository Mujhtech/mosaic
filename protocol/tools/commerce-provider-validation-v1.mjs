import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const commerceProviderV1Root = resolve(toolsDirectory, "..");

export const commerceProviderV1Paths = Object.freeze({
  contractSchema: resolve(
    commerceProviderV1Root,
    "schema/commerce-provider/v1/contract.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    commerceProviderV1Root,
    "schema/commerce-provider/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    commerceProviderV1Root,
    "compatibility/commerce-provider/v1.json",
  ),
  fixtureDirectory: resolve(
    commerceProviderV1Root,
    "fixtures/commerce-provider/v1",
  ),
});

export function readCommerceProviderV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixturePaths() {
  return readdirSync(commerceProviderV1Paths.fixtureDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(commerceProviderV1Paths.fixtureDirectory, name));
}

export function loadCommerceProviderV1Artifacts() {
  const paths = fixturePaths();
  return {
    contractSchema: readCommerceProviderV1Json(
      commerceProviderV1Paths.contractSchema,
    ),
    compatibilityManifestSchema: readCommerceProviderV1Json(
      commerceProviderV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readCommerceProviderV1Json(
      commerceProviderV1Paths.compatibilityManifest,
    ),
    fixturePaths: paths,
    fixtures: paths.map(readCommerceProviderV1Json),
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

export function validateCommerceProviderV1Record(record, contractSchema) {
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
    default:
      errors.push(`Unsupported Commerce Provider record type ${record.recordType}`);
  }
  return errors;
}

/**
 * The size the canonical corpus had when these rules were approved.
 *
 * Found by `tools/check-guard-vacuity.mjs`: the fixture loop below reports no
 * errors over an empty array, so a corpus that failed to load, or a manifest
 * that stopped declaring fixtures, read as perfect conformance.
 */
const COMMERCE_PROVIDER_V1_FIXTURE_FLOOR = 10;

export function validateCommerceProviderV1Artifacts(artifacts) {
  const checks = validators(artifacts);
  const errors = [];
  if (
    !Array.isArray(artifacts.fixtures) ||
    artifacts.fixtures.length < COMMERCE_PROVIDER_V1_FIXTURE_FLOOR
  ) {
    errors.push(
      `Commerce Provider 1 canonical corpus holds ${
        Array.isArray(artifacts.fixtures) ? artifacts.fixtures.length : "no array"
      }, below the floor of ${COMMERCE_PROVIDER_V1_FIXTURE_FLOOR}; a conformance loop over a shrunken corpus passes vacuously`,
    );
    // A corpus that is not an array cannot be walked at all. Continuing would
    // throw from inside the loop, which reads as a tool crash rather than as
    // the missing corpus it is.
    if (!Array.isArray(artifacts.fixtures)) return errors;
  }
  if (!checks.compatibilityManifest(artifacts.compatibilityManifest)) {
    errors.push(
      ...schemaErrors(
        "Commerce Provider compatibility manifest",
        checks.compatibilityManifest.errors,
      ),
    );
  }

  const manifestSchemaPath = resolve(
    dirname(commerceProviderV1Paths.compatibilityManifest),
    artifacts.compatibilityManifest.schema,
  );
  if (manifestSchemaPath !== commerceProviderV1Paths.contractSchema) {
    errors.push("Commerce Provider manifest does not reference the canonical schema");
  }

  const expectedFixturePaths = artifacts.compatibilityManifest.canonicalFixtures
    .map((fixture) =>
      resolve(dirname(commerceProviderV1Paths.compatibilityManifest), fixture),
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
          commerceProviderV1Root,
          fixturePath,
        )}`,
      );
    }
  }

  for (const [index, fixture] of artifacts.fixtures.entries()) {
    const name = relative(
      commerceProviderV1Root,
      artifacts.fixturePaths[index],
    );
    errors.push(
      ...validateCommerceProviderV1Record(
        fixture,
        artifacts.contractSchema,
      ).map((error) => `${name}: ${error}`),
    );
  }
  return errors;
}

export function validateCommerceProviderV1JsonFormatting() {
  const paths = [
    commerceProviderV1Paths.contractSchema,
    commerceProviderV1Paths.compatibilityManifestSchema,
    commerceProviderV1Paths.compatibilityManifest,
    ...fixturePaths(),
  ];
  const errors = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== formatted) {
      errors.push(
        `${relative(commerceProviderV1Root, path)} is not canonical two-space JSON`,
      );
    }
  }
  return errors;
}
