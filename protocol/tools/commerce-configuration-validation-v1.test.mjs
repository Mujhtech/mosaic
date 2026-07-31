import assert from "node:assert/strict";
import test from "node:test";

import {
  commerceConfigurationV1MaterialDigest,
  loadCommerceConfigurationV1Artifacts,
  validateCommerceConfigurationV1,
  validateCommerceConfigurationV1Artifacts,
  validateCommerceConfigurationV1JsonFormatting,
} from "./commerce-configuration-validation-v1.mjs";

function fixture(artifacts, name) {
  const index = artifacts.fixturePaths.findIndex((path) =>
    path.endsWith(`/${name}`),
  );
  assert.notEqual(index, -1, `Missing fixture ${name}`);
  return structuredClone(artifacts.fixtures[index]);
}

function redigest(configuration) {
  configuration.configuration.contentDigest =
    commerceConfigurationV1MaterialDigest(configuration);
  return configuration;
}

test("Commerce Configuration v1 canonical artifacts are valid and formatted", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  assert.deepEqual(validateCommerceConfigurationV1Artifacts(artifacts), []);
  assert.deepEqual(validateCommerceConfigurationV1JsonFormatting(), []);
});

test("Commerce Configuration v1 is exact, closed, and credential-free", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "revenuecat-configuration.json",
  );
  configuration.commerceConfigurationVersion = "2";
  configuration.configuration.activeProvider.publicSdkKey = "forbidden";

  const errors = validateCommerceConfigurationV1(configuration, artifacts);
  assert.ok(errors.some((error) => error.includes("equal to constant")));
  assert.ok(errors.some((error) => error.includes("additional properties")));
});

test("canonical digest covers release association and all mapping material", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "revenuecat-configuration.json",
  );
  configuration.configuration.productMappings[0].providerProductReference =
    "tampered.product";

  assert.ok(
    validateCommerceConfigurationV1(configuration, artifacts).some((error) =>
      error.includes("contentDigest"),
    ),
  );
});

test("accepted release scope must match every association field exactly", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "revenuecat-configuration.json",
  );
  const errors = validateCommerceConfigurationV1(
    configuration,
    artifacts,
    {
      environmentId: "environment_production",
      applicationId: "application_android",
      storePlatform: "android",
      configurationReleaseId: "configuration_release_41",
      configurationReleaseDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mosaicProductIds: [
        "product_pro_monthly",
        "product_missing_from_sidecar",
      ],
    },
  );

  assert.ok(errors.some((error) => error.includes("applicationId")));
  assert.ok(errors.some((error) => error.includes("storePlatform")));
  assert.ok(
    errors.some((error) => error.includes("Configuration Release ID")),
  );
  assert.ok(
    errors.some((error) => error.includes("Configuration Release digest")),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("missing accepted release Products"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("outside the accepted release"),
    ),
  );
});

test("Product, mapping, capability, and Entitlement identities are unambiguous", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "revenuecat-configuration.json",
  );
  configuration.configuration.productMappings[1].mosaicProductId =
    configuration.configuration.productMappings[0].mosaicProductId;
  configuration.configuration.productMappings[1].mappingId =
    configuration.configuration.productMappings[0].mappingId;
  configuration.configuration.productMappings[1].providerProductReference =
    configuration.configuration.productMappings[0].providerProductReference;
  configuration.configuration.productMappings[1].adapterMapping =
    structuredClone(
      configuration.configuration.productMappings[0].adapterMapping,
    );
  configuration.configuration.entitlementMappings.push(
    structuredClone(configuration.configuration.entitlementMappings[0]),
  );
  configuration.configuration.activeProvider.capabilities[1].name =
    configuration.configuration.activeProvider.capabilities[0].name;
  redigest(configuration);

  const errors = validateCommerceConfigurationV1(configuration, artifacts);
  assert.ok(errors.some((error) => error.includes("duplicate product_pro_monthly")));
  assert.ok(errors.some((error) => error.includes("duplicate mapping_pro_monthly_ios")));
  assert.ok(
    errors.some((error) =>
      error.includes("Provider Product mapping targets contains duplicate"),
    ),
  );
  assert.ok(errors.some((error) => error.includes("duplicate pro")));
  assert.ok(errors.some((error) => error.includes("duplicate productLoading")));
});

test("adapter mapping variants and activation freshness cannot be conflated", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "sdk-local-configuration.json",
  );
  configuration.configuration.productMappings[0].adapterMapping = {
    kind: "revenueCatPackage",
    offeringIdentifier: "default",
    packageIdentifier: "$rc_monthly",
  };
  configuration.configuration.freshness.source = "providerSynchronization";
  redigest(configuration);

  const errors = validateCommerceConfigurationV1(configuration, artifacts);
  assert.ok(
    errors.some((error) => error.includes("requires the active provider")),
  );
  assert.ok(
    errors.some((error) => error.includes("does not match sdkLocal")),
  );
});

test("SDK-local custom providers produce an equivalent verified snapshot", () => {
  const artifacts = loadCommerceConfigurationV1Artifacts();
  const configuration = fixture(
    artifacts,
    "sdk-local-configuration.json",
  );
  assert.deepEqual(
    validateCommerceConfigurationV1(configuration, artifacts, {
      environmentId: "environment_development",
      applicationId: "application_android",
      storePlatform: "android",
      configurationReleaseId: "configuration_release_local_7",
      configurationReleaseDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      mosaicProductIds: ["product_pro_monthly"],
    }),
    [],
  );
});
