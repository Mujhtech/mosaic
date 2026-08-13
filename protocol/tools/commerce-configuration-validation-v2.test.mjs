import assert from "node:assert/strict";
import test from "node:test";

import {
  commerceConfigurationV2MaterialDigest,
  loadCommerceConfigurationV2Artifacts,
  validateCommerceConfigurationV2,
  validateCommerceConfigurationV2Artifacts,
  validateCommerceConfigurationV2JsonFormatting,
} from "./commerce-configuration-validation-v2.mjs";

function fixture(artifacts, name) {
  const index = artifacts.fixturePaths.findIndex((path) =>
    path.endsWith(`/${name}`),
  );
  assert.notEqual(index, -1, `Missing fixture ${name}`);
  return structuredClone(artifacts.fixtures[index]);
}

function redigest(configuration) {
  configuration.configuration.contentDigest =
    commerceConfigurationV2MaterialDigest(configuration);
}

test("Commerce Configuration v2 canonical artifacts are valid and formatted", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  assert.deepEqual(validateCommerceConfigurationV2Artifacts(artifacts), []);
  assert.deepEqual(validateCommerceConfigurationV2JsonFormatting(), []);
});

test("native activation is credential-free and platform exact", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(artifacts, "storekit-configuration.json");
  configuration.configuration.activeProvider.identity.id = "google_play";
  redigest(configuration);
  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("requires provider app_store"),
    ),
  );
  assert.deepEqual(
    Object.keys(
      fixture(artifacts, "google-play-configuration.json").configuration
        .activeProvider.activation,
    ),
    ["source"],
  );
});

test("StoreKit and Google fixtures cover the same complete stable Product set", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const expected = [
    "mosaic_pro_lifetime",
    "mosaic_pro_monthly",
    "mosaic_pro_yearly",
  ];
  for (const name of [
    "storekit-configuration.json",
    "google-play-configuration.json",
  ]) {
    assert.deepEqual(
      fixture(artifacts, name).configuration.productMappings
        .map((mapping) => mapping.mosaicProductId)
        .sort(),
      expected,
    );
  }
});

test("Google subscriptions require an exact base plan and never carry an offer token", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(
    artifacts,
    "google-play-configuration.json",
  );
  delete configuration.configuration.productMappings[0].adapterMapping
    .basePlanId;
  redigest(configuration);

  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("requires basePlanId"),
    ),
  );

  const tokenConfiguration = fixture(
    artifacts,
    "google-play-configuration.json",
  );
  tokenConfiguration.configuration.productMappings[0].adapterMapping
    .offerToken = "forbidden";
  redigest(tokenConfiguration);
  assert.ok(
    validateCommerceConfigurationV2(tokenConfiguration, artifacts).some(
      (error) => error.includes("additional properties"),
    ),
  );
});

test("native Product grants are complete and provider Entitlement mappings may be empty", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(
    artifacts,
    "google-play-configuration.json",
  );
  assert.deepEqual(
    configuration.configuration.productMappings[0].entitlementKeys,
    ["pro"],
  );
  assert.deepEqual(configuration.configuration.entitlementMappings, []);

  delete configuration.configuration.productMappings[0].entitlementKeys;
  redigest(configuration);
  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("must have required property 'entitlementKeys'"),
    ),
  );

  const empty = fixture(artifacts, "google-play-configuration.json");
  empty.configuration.productMappings[0].entitlementKeys = [];
  redigest(empty);
  assert.ok(
    validateCommerceConfigurationV2(empty, artifacts).some((error) =>
      error.includes("must NOT have fewer than 1 items"),
    ),
  );
});

test("one native provider Product identifier cannot map to two Mosaic Products", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  for (const name of [
    "storekit-configuration.json",
    "google-play-configuration.json",
  ]) {
    const configuration = fixture(artifacts, name);
    configuration.configuration.productMappings[1].providerProductReference =
      configuration.configuration.productMappings[0].providerProductReference;
    redigest(configuration);
    assert.ok(
      validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
        error.includes("Native Provider Product identifiers contains duplicate"),
      ),
    );
  }
});

test("native configuration capability and recovery modes must remain truthful", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const incomplete = fixture(artifacts, "google-play-configuration.json");
  incomplete.configuration.activeProvider.capabilities.pop();
  redigest(incomplete);
  assert.ok(
    validateCommerceConfigurationV2(incomplete, artifacts).some((error) =>
      error.includes("complete native capability set"),
    ),
  );

  const mismatch = fixture(artifacts, "storekit-configuration.json");
  mismatch.configuration.activeProvider.recoveryMode =
    "activePurchaseRecovery";
  redigest(mismatch);
  assert.ok(
    validateCommerceConfigurationV2(mismatch, artifacts).some((error) =>
      error.includes("requires recovery mode storeSynchronization"),
    ),
  );
});

test("Google one-time Products cannot carry subscription selectors", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(
    artifacts,
    "google-play-configuration.json",
  );
  configuration.configuration.productMappings[2].adapterMapping.basePlanId =
    "monthly";
  redigest(configuration);
  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("forbids basePlanId and offerId"),
    ),
  );
});

test("native configured state is distinct from a fresh provider observation", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(artifacts, "storekit-configuration.json");
  configuration.configuration.freshness.status = "fresh";
  redigest(configuration);
  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("requires an observation"),
    ),
  );
});

test("an unsupported version is rejected without weakening the bundled-fallback policy", () => {
  const artifacts = loadCommerceConfigurationV2Artifacts();
  const configuration = fixture(artifacts, "storekit-configuration.json");
  configuration.commerceConfigurationVersion = "3";
  assert.ok(
    validateCommerceConfigurationV2(configuration, artifacts).some((error) =>
      error.includes("equal to constant"),
    ),
  );
  assert.equal(
    artifacts.compatibilityManifest.readerPolicy.unsupportedVersion,
    "retainLastAcceptedOrBundledFallback",
  );
});
