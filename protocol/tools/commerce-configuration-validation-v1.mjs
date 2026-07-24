import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, sha256Digest } from "./delivery-v1-common.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const commerceConfigurationV1Root = resolve(toolsDirectory, "..");

export const commerceConfigurationV1Paths = Object.freeze({
  configurationSchema: resolve(
    commerceConfigurationV1Root,
    "schema/commerce-configuration/v1/configuration.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    commerceConfigurationV1Root,
    "schema/commerce-configuration/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    commerceConfigurationV1Root,
    "compatibility/commerce-configuration/v1.json",
  ),
  commerceProviderSchema: resolve(
    commerceConfigurationV1Root,
    "schema/commerce-provider/v1/contract.schema.json",
  ),
  fixtureDirectory: resolve(
    commerceConfigurationV1Root,
    "fixtures/commerce-configuration/v1",
  ),
});

export function readCommerceConfigurationV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixturePaths() {
  return readdirSync(commerceConfigurationV1Paths.fixtureDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(commerceConfigurationV1Paths.fixtureDirectory, name));
}

export function loadCommerceConfigurationV1Artifacts() {
  const paths = fixturePaths();
  return {
    configurationSchema: readCommerceConfigurationV1Json(
      commerceConfigurationV1Paths.configurationSchema,
    ),
    compatibilityManifestSchema: readCommerceConfigurationV1Json(
      commerceConfigurationV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readCommerceConfigurationV1Json(
      commerceConfigurationV1Paths.compatibilityManifest,
    ),
    commerceProviderSchema: readCommerceConfigurationV1Json(
      commerceConfigurationV1Paths.commerceProviderSchema,
    ),
    fixturePaths: paths,
    fixtures: paths.map(readCommerceConfigurationV1Json),
  };
}

function validators({
  configurationSchema,
  compatibilityManifestSchema,
  commerceProviderSchema,
}) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(commerceProviderSchema);
  return {
    configuration: ajv.compile(configurationSchema),
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

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function diagnosticSemantics(errors, diagnostics) {
  diagnostics.forEach((diagnostic, index) => {
    if (!diagnostic.retryable && diagnostic.retryAfterSeconds !== undefined) {
      errors.push(
        `configuration.diagnostics[${index}] cannot provide retryAfterSeconds when retryable is false`,
      );
    }
  });
}

function capabilitySemantics(errors, capabilities) {
  requireUnique(
    errors,
    capabilities.map((capability) => capability.name),
    "active provider capabilities",
  );
  capabilities.forEach((capability) => {
    if (
      capability.support === "supported" &&
      capability.reasonCode !== undefined
    ) {
      errors.push(
        `active provider capability ${capability.name} is supported but has a reasonCode`,
      );
    }
    if (
      capability.support !== "supported" &&
      capability.reasonCode === undefined
    ) {
      errors.push(
        `active provider capability ${capability.name} is ${capability.support} without a reasonCode`,
      );
    }
  });
}

function freshnessSemantics(errors, freshness, activationSource) {
  const observedAt = Date.parse(freshness.providerObservedAt);
  const synchronizedAt = Date.parse(freshness.synchronizedAt);
  const staleAt = Date.parse(freshness.staleAt);
  if (synchronizedAt < observedAt) {
    errors.push("configuration freshness synchronizedAt precedes providerObservedAt");
  }
  if (staleAt < synchronizedAt) {
    errors.push("configuration freshness staleAt precedes synchronizedAt");
  }
  if (
    freshness.expiresAt !== undefined &&
    Date.parse(freshness.expiresAt) < staleAt
  ) {
    errors.push("configuration freshness expiresAt precedes staleAt");
  }

  const expectedSource =
    activationSource === "providerConnection"
      ? "providerSynchronization"
      : "sdkLocalSnapshot";
  if (freshness.source !== expectedSource) {
    errors.push(
      `configuration freshness source ${freshness.source} does not match ${activationSource} activation`,
    );
  }
}

export function commerceConfigurationV1MaterialDigest(envelope) {
  const material = structuredClone(envelope.configuration);
  delete material.contentDigest;
  return sha256Digest(material);
}

export function validateCommerceConfigurationV1(
  envelope,
  artifacts = loadCommerceConfigurationV1Artifacts(),
  expectedAssociation,
) {
  const compiled = validators(artifacts);
  if (!compiled.configuration(envelope)) {
    return schemaErrors(
      "Commerce Configuration",
      compiled.configuration.errors,
    );
  }

  const errors = [];
  const configuration = envelope.configuration;
  if (
    configuration.contentDigest !==
    commerceConfigurationV1MaterialDigest(envelope)
  ) {
    errors.push(
      "configuration contentDigest does not match its canonical configuration material",
    );
  }

  if (expectedAssociation !== undefined) {
    for (const field of ["environmentId", "applicationId", "storePlatform"]) {
      if (configuration[field] !== expectedAssociation[field]) {
        errors.push(`configuration ${field} does not match accepted release scope`);
      }
    }
    if (
      configuration.configurationRelease.id !==
      expectedAssociation.configurationReleaseId
    ) {
      errors.push(
        "configuration Configuration Release ID does not match accepted release",
      );
    }
    if (
      configuration.configurationRelease.contentDigest !==
      expectedAssociation.configurationReleaseDigest
    ) {
      errors.push(
        "configuration Configuration Release digest does not match accepted release",
      );
    }
    if (expectedAssociation.mosaicProductIds !== undefined) {
      const actual = new Set(
        configuration.productMappings.map(
          (mapping) => mapping.mosaicProductId,
        ),
      );
      const expected = new Set(expectedAssociation.mosaicProductIds);
      const missing = setDifference(expected, actual);
      const unexpected = setDifference(actual, expected);
      if (missing.length > 0) {
        errors.push(
          `configuration Product mappings are missing accepted release Products ${missing.join(", ")}`,
        );
      }
      if (unexpected.length > 0) {
        errors.push(
          `configuration Product mappings contain Products outside the accepted release ${unexpected.join(", ")}`,
        );
      }
    }
  }

  const { activeProvider, productMappings, entitlementMappings, freshness } =
    configuration;
  capabilitySemantics(errors, activeProvider.capabilities);
  freshnessSemantics(
    errors,
    freshness,
    activeProvider.activation.source,
  );
  diagnosticSemantics(errors, configuration.diagnostics);

  requireUnique(
    errors,
    productMappings.map((mapping) => mapping.mosaicProductId),
    "Product mappings",
  );
  requireUnique(
    errors,
    productMappings.map((mapping) => mapping.mappingId),
    "Product mappings",
  );
  requireUnique(
    errors,
    productMappings.map(
      (mapping) =>
        `${mapping.providerProductReference}:${canonicalJson(mapping.adapterMapping)}`,
    ),
    "Provider Product mapping targets",
  );
  if (
    productMappings.some(
      (mapping) => mapping.adapterMapping.kind === "revenueCatPackage",
    ) &&
    activeProvider.identity.id !== "revenuecat"
  ) {
    errors.push(
      "revenueCatPackage mapping requires the active provider identity revenuecat",
    );
  }

  requireUnique(
    errors,
    entitlementMappings.map((mapping) => mapping.mosaicEntitlementKey),
    "Entitlement mappings",
  );
  requireUnique(
    errors,
    entitlementMappings.map(
      (mapping) => mapping.providerEntitlementIdentifier,
    ),
    "Provider Entitlement mapping targets",
  );
  return errors;
}

export function validateCommerceConfigurationV1Artifacts(
  artifacts = loadCommerceConfigurationV1Artifacts(),
) {
  const compiled = validators(artifacts);
  const errors = [];
  if (!compiled.compatibilityManifest(artifacts.compatibilityManifest)) {
    errors.push(
      ...schemaErrors(
        "Commerce Configuration compatibility manifest",
        compiled.compatibilityManifest.errors,
      ),
    );
  }

  const manifestSchemaPath = resolve(
    dirname(commerceConfigurationV1Paths.compatibilityManifest),
    artifacts.compatibilityManifest.schema,
  );
  if (manifestSchemaPath !== commerceConfigurationV1Paths.configurationSchema) {
    errors.push(
      "Commerce Configuration manifest does not reference the canonical schema",
    );
  }

  const expectedFixturePaths = artifacts.compatibilityManifest.canonicalFixtures
    .map((fixture) =>
      resolve(
        dirname(commerceConfigurationV1Paths.compatibilityManifest),
        fixture,
      ),
    )
    .sort();
  if (
    JSON.stringify(expectedFixturePaths) !==
    JSON.stringify([...artifacts.fixturePaths].sort())
  ) {
    errors.push(
      "Commerce Configuration manifest canonicalFixtures do not exactly match the fixture directory",
    );
  }
  for (const fixturePath of expectedFixturePaths) {
    if (!existsSync(fixturePath)) {
      errors.push(
        `Commerce Configuration manifest references missing fixture ${relative(
          commerceConfigurationV1Root,
          fixturePath,
        )}`,
      );
    }
  }

  artifacts.fixtures.forEach((fixture, index) => {
    const name = relative(
      commerceConfigurationV1Root,
      artifacts.fixturePaths[index],
    );
    errors.push(
      ...validateCommerceConfigurationV1(fixture, artifacts).map(
        (error) => `${name}: ${error}`,
      ),
    );
  });
  return errors;
}

export function validateCommerceConfigurationV1JsonFormatting() {
  const paths = [
    commerceConfigurationV1Paths.configurationSchema,
    commerceConfigurationV1Paths.compatibilityManifestSchema,
    commerceConfigurationV1Paths.compatibilityManifest,
    ...fixturePaths(),
  ];
  const errors = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== formatted) {
      errors.push(
        `${relative(commerceConfigurationV1Root, path)} is not canonical two-space JSON`,
      );
    }
  }
  return errors;
}
