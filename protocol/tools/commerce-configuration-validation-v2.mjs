import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, sha256Digest } from "./delivery-common.mjs";
import { nativeCapabilitySupport } from "./commerce-provider-validation-v2.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const commerceConfigurationV2Root = resolve(toolsDirectory, "..");

export const commerceConfigurationV2Paths = Object.freeze({
  configurationSchema: resolve(
    commerceConfigurationV2Root,
    "schema/commerce-configuration/v2/configuration.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    commerceConfigurationV2Root,
    "schema/commerce-configuration/v2/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    commerceConfigurationV2Root,
    "compatibility/commerce-configuration/v2.json",
  ),
  commerceProviderSchema: resolve(
    commerceConfigurationV2Root,
    "schema/commerce-provider/v2/contract.schema.json",
  ),
  fixtureDirectory: resolve(
    commerceConfigurationV2Root,
    "fixtures/commerce-configuration/v2",
  ),
});

export function readCommerceConfigurationV2Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixturePaths() {
  return readdirSync(commerceConfigurationV2Paths.fixtureDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(commerceConfigurationV2Paths.fixtureDirectory, name));
}

export function loadCommerceConfigurationV2Artifacts() {
  const paths = fixturePaths();
  return {
    configurationSchema: readCommerceConfigurationV2Json(
      commerceConfigurationV2Paths.configurationSchema,
    ),
    compatibilityManifestSchema: readCommerceConfigurationV2Json(
      commerceConfigurationV2Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readCommerceConfigurationV2Json(
      commerceConfigurationV2Paths.compatibilityManifest,
    ),
    commerceProviderSchema: readCommerceConfigurationV2Json(
      commerceConfigurationV2Paths.commerceProviderSchema,
    ),
    fixturePaths: paths,
    fixtures: paths.map(readCommerceConfigurationV2Json),
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

function nativeCapabilitySemantics(errors, providerId, capabilities) {
  const expected = nativeCapabilitySupport[providerId];
  if (expected === undefined) return;
  const actual = new Map(
    capabilities.map((capability) => [capability.name, capability.support]),
  );
  for (const [name, support] of Object.entries(expected)) {
    if (actual.get(name) !== support) {
      errors.push(
        `active provider ${providerId} capability ${name} must be ${support}`,
      );
    }
  }
  if (capabilities.length !== Object.keys(expected).length) {
    errors.push(
      `active provider ${providerId} must declare the complete native capability set`,
    );
  }
}

function freshnessSemantics(errors, freshness, activationSource) {
  if (activationSource === "nativeStore") {
    if (freshness.source !== "nativeStoreConfiguration") {
      errors.push(
        `configuration freshness source ${freshness.source} does not match nativeStore activation`,
      );
    }
    if (freshness.status !== "configured" && freshness.observation === undefined) {
      errors.push(
        `native Store freshness ${freshness.status} requires an observation`,
      );
    }
    if (
      freshness.observation?.expiresAt !== undefined &&
      Date.parse(freshness.observation.expiresAt) <
        Date.parse(freshness.observation.observedAt)
    ) {
      errors.push("native Store observation expiresAt precedes observedAt");
    }
    return;
  }
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

export function commerceConfigurationV2MaterialDigest(envelope) {
  const material = structuredClone(envelope.configuration);
  delete material.contentDigest;
  return sha256Digest(material);
}

export function validateCommerceConfigurationV2(
  envelope,
  artifacts = loadCommerceConfigurationV2Artifacts(),
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
  const { activeProvider, productMappings, entitlementMappings, freshness } =
    configuration;
  if (
    configuration.contentDigest !==
    commerceConfigurationV2MaterialDigest(envelope)
  ) {
    errors.push(
      "configuration contentDigest does not match its canonical configuration material",
    );
  }

  if (activeProvider.activation.source === "nativeStore") {
    const expectedProvider =
      configuration.storePlatform === "ios" ? "app_store" : "google_play";
    if (activeProvider.identity.id !== expectedProvider) {
      errors.push(
        `nativeStore ${configuration.storePlatform} activation requires provider ${expectedProvider}`,
      );
    }
    const expectedRecovery =
      configuration.storePlatform === "ios"
        ? "storeSynchronization"
        : "activePurchaseRecovery";
    if (activeProvider.recoveryMode !== expectedRecovery) {
      errors.push(
        `nativeStore ${configuration.storePlatform} activation requires recovery mode ${expectedRecovery}`,
      );
    }
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

  capabilitySemantics(errors, activeProvider.capabilities);
  if (activeProvider.activation.source === "nativeStore") {
    nativeCapabilitySemantics(
      errors,
      activeProvider.identity.id,
      activeProvider.capabilities,
    );
  }
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
  productMappings.forEach((mapping, index) => {
    requireUnique(
      errors,
      mapping.entitlementKeys,
      `Product mappings[${index}].entitlementKeys`,
    );
    const detail = mapping.adapterMapping;
    if (
      detail.kind === "storeKitProduct" &&
      (configuration.storePlatform !== "ios" ||
        activeProvider.identity.id !== "app_store")
    ) {
      errors.push("storeKitProduct mapping requires iOS app_store activation");
    }
    if (
      detail.kind === "googlePlayProduct" &&
      (configuration.storePlatform !== "android" ||
        activeProvider.identity.id !== "google_play")
    ) {
      errors.push(
        "googlePlayProduct mapping requires Android google_play activation",
      );
    }
    if (
      detail.kind === "googlePlayProduct" &&
      mapping.productType === "subscription" &&
      detail.basePlanId === undefined
    ) {
      errors.push("Google subscription mapping requires basePlanId");
    }
    if (
      detail.kind === "googlePlayProduct" &&
      mapping.productType === "one_time_non_consumable" &&
      (detail.basePlanId !== undefined || detail.offerId !== undefined)
    ) {
      errors.push(
        "Google one-time non-consumable mapping forbids basePlanId and offerId",
      );
    }
  });
  requireUnique(
    errors,
    productMappings.map((mapping) => mapping.mappingId),
    "Product mappings",
  );
  if (activeProvider.activation.source === "nativeStore") {
    requireUnique(
      errors,
      productMappings.map((mapping) => mapping.providerProductReference),
      "Native Provider Product identifiers",
    );
  }
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

export function validateCommerceConfigurationV2Artifacts(
  artifacts = loadCommerceConfigurationV2Artifacts(),
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
    dirname(commerceConfigurationV2Paths.compatibilityManifest),
    artifacts.compatibilityManifest.schema,
  );
  if (manifestSchemaPath !== commerceConfigurationV2Paths.configurationSchema) {
    errors.push(
      "Commerce Configuration manifest does not reference the canonical schema",
    );
  }

  const expectedFixturePaths = artifacts.compatibilityManifest.canonicalFixtures
    .map((fixture) =>
      resolve(
        dirname(commerceConfigurationV2Paths.compatibilityManifest),
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
          commerceConfigurationV2Root,
          fixturePath,
        )}`,
      );
    }
  }

  artifacts.fixtures.forEach((fixture, index) => {
    const name = relative(
      commerceConfigurationV2Root,
      artifacts.fixturePaths[index],
    );
    errors.push(
      ...validateCommerceConfigurationV2(fixture, artifacts).map(
        (error) => `${name}: ${error}`,
      ),
    );
  });
  errors.push(...declaredVocabularyCoverage(artifacts));
  return errors;
}

/**
 * Every activation source, adapter mapping kind, and freshness source the
 * contract declares must be exercised by a canonical fixture.
 *
 * A declared vocabulary with no fixture is a surface every SDK implements from
 * prose: nothing pins what a `revenueCatPackage` mapping or an `sdkLocal`
 * activation actually looks like, and nothing fails when one stops being
 * produced. This corpus lost exactly that coverage once, when the v1 fixtures
 * were deleted and only the two native-store v2 fixtures remained.
 */
function declaredVocabularyCoverage(artifacts) {
  const errors = [];
  const activationSources = new Set();
  const adapterMappingKinds = new Set();
  const freshnessSources = new Set();
  for (const { configuration } of artifacts.fixtures) {
    activationSources.add(configuration.activeProvider.activation.source);
    freshnessSources.add(configuration.freshness.source);
    for (const mapping of configuration.productMappings) {
      adapterMappingKinds.add(mapping.adapterMapping.kind);
    }
  }
  for (const [declared, exercised, label] of [
    [
      artifacts.compatibilityManifest.activationSources,
      activationSources,
      "activation source",
    ],
    [
      artifacts.compatibilityManifest.adapterMappingKinds,
      adapterMappingKinds,
      "adapter mapping kind",
    ],
  ]) {
    for (const value of declared) {
      if (exercised.has(value)) continue;
      errors.push(`no canonical fixture exercises declared ${label} ${value}`);
    }
  }
  // Freshness has no manifest list; the schema's own union is the vocabulary.
  for (const source of ["providerSynchronization", "sdkLocalSnapshot", "nativeStoreConfiguration"]) {
    if (freshnessSources.has(source)) continue;
    errors.push(`no canonical fixture exercises freshness source ${source}`);
  }
  return errors;
}

export function validateCommerceConfigurationV2JsonFormatting() {
  const paths = [
    commerceConfigurationV2Paths.configurationSchema,
    commerceConfigurationV2Paths.compatibilityManifestSchema,
    commerceConfigurationV2Paths.compatibilityManifest,
    ...fixturePaths(),
  ];
  const errors = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== formatted) {
      errors.push(
        `${relative(commerceConfigurationV2Root, path)} is not canonical two-space JSON`,
      );
    }
  }
  return errors;
}
